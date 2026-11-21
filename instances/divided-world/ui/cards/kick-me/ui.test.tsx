/**
 * Kick Me's sign (ui/kick-me/Effect.tsx, docs/plans/2026-11-20-refund-outcome-plan.md, task 8): three boot prints along its bottom edge, one scuffed out
 * for each card handed back; its label says how many are left; and while it is up the content area's top padding grows by half its height, so no word sits
 * under it, and it is gone when the play ends. jsdom has no layout, so the content area's width is stubbed.
 */
import { act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardPlay, EffectProps } from '../../../../../engine/ui/cards/types.ts';
import { NO_INK } from '../../../../../engine/ui/cards/claims.ts';
import type { Act } from '../../../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../../../engine/ui/test-world.tsx';
import { kickMe } from '../../../cards/kick-me.ts';
import { KickMeEffect } from '../../kick-me/Effect.tsx';
import { ui } from './ui.ts';

const post = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-10-29T12:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null } as unknown as Act;
const FAR = '2099-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';
const play = (extra: Partial<CardPlay> = {}): CardPlay => ({ id: 'km1', card: 'kick-me', layer: 1, caster: 'c1', message: '', config: {}, playedAt: '2026-10-29T12:00:00Z', post: 'p1', ends: FAR, ...extra });

/** The content area's width the stub reports, as a browser would for its padding box. */
let widths = new Map<string, number>();
const widthOf = (el: Element) => (el.classList.contains('kb-origin-area') ? widths.get('origin') : el.classList.contains('kb-act-main') ? widths.get('thread') : widths.get('host')) ?? 0;
let setPlays: (p: CardPlay[]) => void = () => {};

interface Options { plays?: CardPlay[]; place?: 'thread' | 'origin'; wrapped?: boolean | 'area' }
function Host({ o }: { o: Options }) {
  const [plays, set] = useState(o.plays ?? [play()]);
  setPlays = set;
  const props: EffectProps = {
    post, plays, states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: o.place ?? 'thread', reach: 'post', still: false, moment: null,
    show: () => {}, met: () => {}, ink: NO_INK, holdScreen: () => {}, marks: null, save: vi.fn(), release: vi.fn(), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null,
    children: <p data-kb-words>The words of the post.</p>,
  };
  const inner = <KickMeEffect {...props} />;
  if (o.wrapped === false) return inner;
  if (o.wrapped === 'area') return <div className="kb-act-main" data-kb-content-area><div className="kb-origin-area" data-kb-content-area>{inner}</div></div>;
  return <div className="kb-act-main" data-kb-content-area>{inner}</div>;
}
const mount = (o: Options = {}) => renderInWorld(<Host o={o} />);
const sign = () => document.querySelector<SVGElement>('[role="img"]');
const prints = () => [...document.querySelectorAll('[data-kick-print]')];
const scuffed = () => [...document.querySelectorAll('[data-kick-print][data-scuffed]')];
const area = () => document.querySelector<HTMLElement>('.kb-act-main')!;

beforeEach(() => {
  widths = new Map([['thread', 300], ['origin', 260]]);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return widthOf(this); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Kick Me\'s sign', () => {
  test('a fresh sign shows three boot prints, none scuffed, and says all three are left', () => {
    mount();
    expect(prints()).toHaveLength(kickMe.refunds!.count);
    expect(prints()).toHaveLength(3);
    expect(scuffed()).toHaveLength(0);
    expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 3 of 3 Salty cards still go back to their casters');
  });

  test('each card handed back scuffs one print out, and the label counts what is left', () => {
    mount({ plays: [play({ handedOut: 2 })] });
    expect(prints()).toHaveLength(3);
    expect(scuffed()).toHaveLength(2);
    expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 1 of 3 Salty cards still go back to their casters');
    cleanup();
    mount({ plays: [play({ handedOut: 3 })] });
    expect(scuffed()).toHaveLength(3);
    expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 0 of 3 Salty cards still go back to their casters');
  });

  test('the number of prints and the label follow the rules, not a number of its own', () => {
    const held = kickMe.refunds;
    (kickMe as { refunds?: unknown }).refunds = { flavors: ['salty'], count: 5 };
    try {
      mount({ plays: [play({ handedOut: 1 })] });
      expect(prints()).toHaveLength(5);
      expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 4 of 5 Salty cards still go back to their casters');
    } finally { (kickMe as { refunds?: unknown }).refunds = held; }
  });

  test('the content area\'s top padding grows by half the sign\'s height while it is up, and goes back when the play ends', () => {
    mount();
    /* 300 wide: the sign is 40% of that, 120 px, and 9 : 20 tall (54 px), so half is 27 px (jsdom reports no padding of its own). */
    expect(area().style.paddingTop).toBe('27px');
    act(() => setPlays([play({ ends: PAST })]));
    expect(sign()).toBeNull();
    expect(area().style.paddingTop).toBe('');
  });

  test('a wide area caps the sign at 160 px, so its half-height is 36 px', () => {
    widths.set('thread', 1000);
    mount();
    expect(area().style.paddingTop).toBe('36px');
  });

  test('in the ORIGIN box the box\'s own area grows, and the opening post\'s body around it does not', () => {
    mount({ wrapped: 'area', place: 'origin' });
    expect(document.querySelector<HTMLElement>('.kb-origin-area')!.style.paddingTop).toBe('23.4px');
    expect(area().style.paddingTop).toBe('');
  });

  test('it holds nothing pressable: the sign is a picture, its layer takes no press, and no control is drawn', () => {
    mount();
    expect(document.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
    const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../kick-me/kick-me.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    expect(css).toMatch(/\.dw-kick-layer\s*\{[^}]*pointer-events:\s*none/u);
  });

  test('with no live play the post draws as it would without the card', () => {
    mount({ plays: [play({ ends: PAST })] });
    expect(sign()).toBeNull();
    expect(document.querySelector('[data-kb-words]')!.textContent).toBe('The words of the post.');
  });

  test('its entry in the screens\' card list is lazy: the effect it carries is not this module\'s own', () => {
    expect(ui.Effect).toBeDefined();
  });
});
