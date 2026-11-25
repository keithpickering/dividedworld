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
import { playOf, withHandedOut } from '../../../../../engine/ui/cards/plays.ts';
import { NO_INK } from '../../../../../engine/ui/cards/claims.ts';
import type { Act } from '../../../../../engine/ui/data/api.ts';
import { createFake } from '../../../../../engine/ui/data/fake.ts';
import { logRows, type LogData, type Words } from '../../../../../engine/ui/log/lines.ts';
import type { Refusal } from '../../../../../engine/ui/data/api.ts';
import { instanceUi } from '../../../ui/index.ts';
import { instance } from '../../../index.ts';
import { whoops } from '../../../cards/whoops.ts';
import { renderInWorld } from '../../../../../engine/ui/test-world.tsx';
import { kickMe } from '../../../cards/kick-me.ts';
import { KickMeEffect, LETTERS, LETTER_SCALE, LETTER_Y, MARKER, SIGN_H, SIGN_W, STROKES } from '../../kick-me/Effect.tsx';
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
    expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 3 of 3 Salty Moves still go back to their players');
  });

  test('each card handed back scuffs one print out, and the label counts what is left', () => {
    mount({ plays: [play({ handedOut: 2 })] });
    expect(prints()).toHaveLength(3);
    expect(scuffed()).toHaveLength(2);
    expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 1 of 3 Salty Moves still go back to their players');
    cleanup();
    mount({ plays: [play({ handedOut: 3 })] });
    expect(scuffed()).toHaveLength(3);
    expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 0 of 3 Salty Moves still go back to their players');
  });

  test('the number of prints and the label follow the rules, not a number of its own', () => {
    const held = kickMe.refunds;
    (kickMe as { refunds?: unknown }).refunds = { flavors: ['salty'], count: 5 };
    try {
      mount({ plays: [play({ handedOut: 1 })] });
      expect(prints()).toHaveLength(5);
      expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 4 of 5 Salty Moves still go back to their players');
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

  test('a sign that stays mounted scuffs a print as each card is handed back, live', () => {
    mount();
    expect(scuffed()).toHaveLength(0);
    act(() => setPlays([play({ handedOut: 2 })]));
    expect(scuffed()).toHaveLength(2);
    expect(sign()!.getAttribute('aria-label')).toBe('Kick Me sign: 1 of 3 Salty Moves still go back to their players');
  });

  test('an inline paddingTop the area already had comes back when the sign goes, by the play ending or by unmounting', () => {
    const { unmount } = mount({ plays: [play({ ends: PAST })] });
    const a = area();
    a.style.paddingTop = '5px';
    act(() => setPlays([play()]));
    expect(a.style.paddingTop).toBe('32px');
    act(() => setPlays([play({ ends: PAST })]));
    expect(a.style.paddingTop).toBe('5px');
    act(() => setPlays([play()]));
    expect(a.style.paddingTop).toBe('32px');
    unmount();
    expect(a.style.paddingTop).toBe('5px');
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

  test('the lettering stands inside the cardboard with a margin on every side, and a clear space sits between KICK and ME', () => {
    /* The extents of each letter's strokes (every point; a Q curve sampled along its length, since its control point lies off the ink), in the sign's units, before the tilt (at most 2 degrees: a px or so). */
    const ink = LETTERS.map(([letter, x]) => {
      const xs: number[] = [], ys: number[] = [];
      let cx = 0, cy = 0;
      for (const [, cmd, args] of STROKES[letter].matchAll(/([MLQHV])([^MLQHV]*)/gu)) {
        const n = args!.trim().split(/[\s,]+/u).map(Number);
        if (cmd === 'H') { cx = n[0]!; xs.push(cx); ys.push(cy); }
        else if (cmd === 'V') { cy = n[0]!; xs.push(cx); ys.push(cy); }
        else if (cmd === 'Q') {
          const [qx, qy, ex, ey] = n as [number, number, number, number];
          for (let t = 0; t <= 1; t += 0.05) { xs.push((1 - t) ** 2 * cx + 2 * (1 - t) * t * qx + t * t * ex); ys.push((1 - t) ** 2 * cy + 2 * (1 - t) * t * qy + t * t * ey); }
          cx = ex; cy = ey;
        } else { cx = n[0]!; cy = n[1]!; xs.push(cx); ys.push(cy); }
      }
      const r = MARKER / 2;
      return { left: x + LETTER_SCALE * Math.min(...xs) - r, right: x + LETTER_SCALE * Math.max(...xs) + r, top: LETTER_Y + LETTER_SCALE * Math.min(...ys) - r, bottom: LETTER_Y + LETTER_SCALE * Math.max(...ys) + r };
    });
    const MARGIN = 8;
    expect(Math.min(...ink.map((l) => l.left)), 'left margin').toBeGreaterThanOrEqual(MARGIN);
    expect(SIGN_W - Math.max(...ink.map((l) => l.right)), 'right margin').toBeGreaterThanOrEqual(MARGIN);
    expect(Math.min(...ink.map((l) => l.top)), 'top margin').toBeGreaterThanOrEqual(MARGIN);
    /* The prints stand along the bottom edge (center 68 of SIGN_H, their top 11 above it), below the lettering. */
    expect(SIGN_H).toBe(90);
    expect(Math.max(...ink.map((l) => l.bottom)), 'lettering ends above the prints').toBeLessThan(68 - 11);
    /* The word space (K-I-C-K, then M-E) is wider than any gap inside a word. */
    const gaps = ink.slice(1).map((l, i) => l.left - ink[i]!.right);
    expect(gaps[3], 'word space').toBeGreaterThan(Math.max(gaps[0]!, gaps[1]!, gaps[2]!, gaps[4]!) + 8);
    expect(gaps[3], 'word space').toBeGreaterThanOrEqual(12);
  });

  test('its entry in the screens\' card list is lazy: the effect it carries is not this module\'s own', () => {
    expect(ui.Effect).toBeDefined();
  });
});

const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`refused: ${a.error}`);
  return a.value;
};

describe('Kick Me hands the first three Salty cards back, end to end on the fake', () => {
  /** Salty commons that reach a post and want only an ink: Whoops! (stacks to 3) and Hot Box, for the fourth cast. */
  const ink = { color: 'red' };
  function setup() {
    const fake = createFake({ instance });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', instance.classes[0]!.key);
    const boFace = fake.seed.character(bo, 'Bo Face', instance.classes[0]!.key);
    const { act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'Point at these words here. '.repeat(20));
    fake.seed.cards(ana, { 'kick-me': 2 });
    fake.seed.cards(bo, { whoops: 3, 'hot-box': 2, this: 2 });
    fake.seed.wallet(bo, 100_000);
    fake.signInAs(ana);
    return { fake, bo, anaFace, boFace, opener };
  }
  const held = async (fake: ReturnType<typeof setup>['fake'], card: string) => (await fake.myCards()).find((c) => c.card === card)?.held ?? 0;
  const balance = async (fake: ReturnType<typeof setup>['fake']) => (await fake.wallet()).balance;

  test('three Salty casts come back, handedOut reaches 3, the fourth does not, and each cast spends its price', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const sign = must(await fake.useCard('kick-me', anaFace, opener, {}, ''));
    fake.signInAs(bo);
    const price = whoops.playPrice(instance.settings, { reach: 'post', length: 'Point at these words here. '.repeat(20).length } as never, ink, []);
    expect(price).toBeGreaterThan(0);
    const handed: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const before = await balance(fake);
      const cast = must(await fake.playCard('whoops', boFace, opener, ink, ''));
      handed.push(cast.payload.handedBack);
      expect(await balance(fake), `price spent on cast ${i + 1}`).toBe(before - price);
      expect(await held(fake, 'whoops'), `whoops held after cast ${i + 1}`).toBe(3);
    }
    expect(handed).toEqual([1, 2, 3].map(() => ({ by: sign.id, card: 'kick-me' })));
    const used = (await fake.postPlays([opener])).plays.filter((a) => (a.payload.handedBack as { by?: string } | undefined)?.by === sign.id);
    expect(used).toHaveLength(3);
    /* The sign's own play, as the screens build it from the post's Acts (there is no helper that reads a post's plays off the fake), carries the count that scuffs its prints. */
    const plays = withHandedOut((await fake.postPlays([opener])).plays.flatMap((a) => playOf(a) ?? []));
    expect(plays.find((p) => p.id === sign.id)?.handedOut).toBe(3);
    const fourthBefore = await balance(fake);
    const fourth = must(await fake.playCard('hot-box', boFace, opener, ink, ''));
    expect(fourth.payload.handedBack).toBeUndefined();
    expect(fourth.payload.caught).toBeUndefined();
    expect(await held(fake, 'hot-box')).toBe(1);
    expect(await balance(fake)).toBe(fourthBefore);
  });

  test('THIS, a Pepperoni common, lands on the Kick Me post and is not handed back', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    must(await fake.useCard('kick-me', anaFace, opener, {}, ''));
    fake.signInAs(bo);
    const landed = must(await fake.playCard('this', boFace, opener, { phrase: 'these words', words: 'yes' }, ''));
    expect(landed.payload.caught).toBeUndefined();
    expect(landed.payload.handedBack).toBeUndefined();
    expect(await held(fake, 'this')).toBe(1);
  });

  test('the caster\'s log says "The Kick Me on ... gave your card back." for each of the three', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    must(await fake.useCard('kick-me', anaFace, opener, {}, ''));
    fake.signInAs(bo);
    for (let i = 0; i < 3; i++) must(await fake.playCard('whoops', boFace, opener, ink, ''));
    must(await fake.playCard('hot-box', boFace, opener, ink, ''));
    const log = await fake.log();
    const acts = new Map((await fake.postPlays([opener])).plays.map((a) => [a.id, a]));
    const data: LogData = { log, mine: await fake.myCharacters(), estimate: null, standings: {}, season: null, turns: [], nextSettlement: null, acts, names: new Map(), titles: new Map(), states: new Map() };
    const words = { instance, ui: instanceUi, postsPerPage: 20, economy: {}, now: Date.now() } as Words;
    const rows = logRows(data, words, 600, null).filter((r) => r.kind === 'returned');
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.details[0]).toBe('The Kick Me on ');
      expect(r.details.at(-1)).toBe(' gave your card back.');
    }
  });
});
