/**
 * A content area is an element that says so (docs/plans/2026-11-15-origin-box-effects-design.md, section 2): the post's body in a thread
 * and on the front door carries `data-kb-content-area`, `bodyOf` finds the nearest one, and `liftedOver` (section 4) says whether a press
 * landed on a lifted thing inside the body an effect found. The module is read as a namespace so that a missing function fails its own case.
 */
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { LoadedThread } from '../loaded.tsx';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { buildWorld, renderIn, renderInWorld } from '../test-world.tsx';
import * as bodyModule from './body.ts';

type Lookup = (host: Element, place?: unknown) => HTMLElement | null;
type Lifted = (target: unknown, area: Element | null) => boolean;
const bodyOf = bodyModule.bodyOf as Lookup;
const lifted: Lifted = (target, area) => {
  const fn = (bodyModule as unknown as { liftedOver?: Lifted }).liftedOver;
  if (!fn) throw new Error('body.ts exports no liftedOver');
  return fn(target, area);
};

const mount = (html: string): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};
afterEach(() => { document.body.innerHTML = ''; });

describe('bodyOf', () => {
  test('returns the nearest marked ancestor: a host in a marked div inside another marked div gets the inner one', () => {
    const root = mount('<div id="outer" data-kb-content-area><div id="inner" data-kb-content-area><p><span id="host">words</span></p></div></div>');
    expect(bodyOf(root.querySelector('#host')!)?.id).toBe('inner');
  });

  test('returns an element that is itself marked', () => {
    const root = mount('<div id="outer" data-kb-content-area><div id="self" data-kb-content-area></div></div>');
    expect(bodyOf(root.querySelector('#self')!)?.id).toBe('self');
  });

  test('returns null with no marked ancestor, and an unmarked div.kb-act-main is not a body', () => {
    const root = mount('<div class="kb-act-main"><span id="host">words</span></div>');
    expect(bodyOf(root.querySelector('#host')!)).toBeNull();
    expect(bodyOf(root.querySelector('#host')!, 'thread')).toBeNull();
  });
});

describe('liftedOver', () => {
  const area = () => mount('<div id="body" data-kb-content-area><div id="lift" data-kb-over-ink><button id="in">History</button></div><p id="words">words</p></div>').querySelector<HTMLElement>('#body')!;

  test('a target inside a lifted element inside the body is lifted over', () => {
    const b = area();
    expect(lifted(b.querySelector('#in'), b)).toBe(true);
    expect(lifted(b.querySelector('#lift'), b)).toBe(true);
  });

  test('a target whose lifted ancestor contains the body is not', () => {
    const root = mount('<div id="box" data-kb-over-ink><div id="body" data-kb-content-area><span id="words">words</span></div></div>');
    expect(lifted(root.querySelector('#words'), root.querySelector('#body'))).toBe(false);
  });

  test('a target with no lifted ancestor is not', () => {
    const b = area();
    expect(lifted(b.querySelector('#words'), b)).toBe(false);
  });

  test('a null body counts any lifted ancestor', () => {
    const b = area();
    expect(lifted(b.querySelector('#in'), null)).toBe(true);
    expect(lifted(b.querySelector('#words'), null)).toBe(false);
  });

  test('a text node counts as its parent element', () => {
    const b = area();
    expect(lifted(b.querySelector('#in')!.firstChild, b)).toBe(true);
    expect(lifted(b.querySelector('#words')!.firstChild, b)).toBe(false);
  });

  test('a body that is itself lifted is lifted over: the nearest lifted element is the body, and it contains itself', () => {
    const root = mount('<div id="body" data-kb-content-area data-kb-over-ink><span id="words">words</span></div>');
    const b = root.querySelector<HTMLElement>('#body')!;
    expect(lifted(b.querySelector('#words'), b)).toBe(true);
    expect(lifted(b, b)).toBe(true);
  });

  test('with lifts nested, the nearest wins: a lifted button in a body in a lifted box is lifted over, a plain word in that body is not', () => {
    const root = mount('<div id="box" data-kb-over-ink><div id="body" data-kb-content-area><button id="btn" data-kb-over-ink>History</button><span id="words">words</span></div></div>');
    const b = root.querySelector<HTMLElement>('#body')!;
    expect(lifted(b.querySelector('#btn'), b)).toBe(true);
    expect(lifted(b.querySelector('#words'), b)).toBe(false);
  });

  test('an SVG element target inside a lifted element in the body is lifted over', () => {
    const root = mount('<div id="body" data-kb-content-area><div data-kb-over-ink><svg><path id="p" d="M0 0"/></svg></div></div>');
    const p = root.querySelector('#p')!;
    expect(p instanceof SVGElement).toBe(true);
    expect(lifted(p, root.querySelector('#body'))).toBe(true);
  });

  test('a detached node with no lifted ancestor is not lifted over', () => {
    const lone = document.createElement('span');
    expect(lifted(lone, null)).toBe(false);
    expect(lifted(lone, document.createElement('div'))).toBe(false);
  });

  test('what is no element is not lifted over', () => {
    const b = area();
    expect(lifted(null, b)).toBe(false);
    expect(lifted({}, b)).toBe(false);
    expect(lifted(undefined, null)).toBe(false);
  });
});

describe('the places that draw a post\'s body mark it', () => {
  test('a thread post\'s .kb-act-main carries data-kb-content-area', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    const { thread } = fake.seed.thread('general', pipe, 'A thread', 'post 1');
    fake.signInAs(me);
    renderIn(fake, <LoadedThread thread={thread} />, { path: `/t/${thread}` });
    const post = await screen.findByRole('article', { name: /^Post 1 /u });
    const main = post.querySelector('.kb-act-main')!;
    expect(main).toHaveAttribute('data-kb-content-area');
    expect(bodyOf(main.querySelector('.kb-bb')!)).toBe(main);
  });

  test('the front door\'s .kb-act-main carries it too', () => {
    renderInWorld(<FrontDoor />);
    const mains = [...document.querySelectorAll('article.kb-act .kb-act-main')];
    expect(mains.length).toBeGreaterThan(0);
    for (const m of mains) expect(m).toHaveAttribute('data-kb-content-area');
  });
});

/* The bend interface (docs/plans/2026-11-23-dent-bend-design.md, section 2.3): one helper sets the two filters, a lookup finds the words box. */
describe('setBend', () => {
  const bend = { area: 'url("#a")', words: 'url("#w")' };
  test('sets both properties on the area and none on the host', () => {
    const root = mount('<div data-kb-content-area id="area"><span id="host"></span></div>');
    const area = root.querySelector<HTMLElement>('#area')!, host = root.querySelector<HTMLElement>('#host')!;
    bodyModule.setBend(area, host, bend);
    expect(area.style.getPropertyValue('--kb-bend')).toBe('url("#a")');
    expect(area.style.getPropertyValue('--kb-bend-words')).toBe('url("#w")');
    expect(host.style.getPropertyValue('--kb-bend')).toBe('');
    expect(host.style.getPropertyValue('--kb-bend-words')).toBe('');
  });
  test('with no area, sets only --kb-bend-words, on the host', () => {
    const host = mount('<span id="host"></span>').querySelector<HTMLElement>('#host')!;
    bodyModule.setBend(null, host, bend);
    expect(host.style.getPropertyValue('--kb-bend-words')).toBe('url("#w")');
    expect(host.style.getPropertyValue('--kb-bend')).toBe('');
  });
  test('null removes what it set, from the area or from the host', () => {
    const root = mount('<div data-kb-content-area id="area"><span id="host"></span></div><span id="lone"></span>');
    const area = root.querySelector<HTMLElement>('#area')!, host = root.querySelector<HTMLElement>('#host')!, lone = root.querySelector<HTMLElement>('#lone')!;
    bodyModule.setBend(area, host, bend);
    bodyModule.setBend(null, lone, bend);
    bodyModule.setBend(area, host, null);
    bodyModule.setBend(null, lone, null);
    expect(area.style.getPropertyValue('--kb-bend')).toBe('');
    expect(area.style.getPropertyValue('--kb-bend-words')).toBe('');
    expect(lone.style.getPropertyValue('--kb-bend-words')).toBe('');
  });
});

describe('wordsBoxOf', () => {
  test('finds the words box of the host\'s own content area', () => {
    const root = mount('<div data-kb-content-area id="area"><div data-kb-words-box id="box"></div></div>');
    expect(bodyModule.wordsBoxOf(root.querySelector<HTMLElement>('#area')!)).toBe(root.querySelector('#box'));
  });
  test('skips a box inside a nested content area', () => {
    const root = mount('<div data-kb-content-area id="area"><div data-kb-content-area><div data-kb-words-box id="inner"></div></div><div data-kb-words-box id="own"></div></div>');
    expect(bodyModule.wordsBoxOf(root.querySelector<HTMLElement>('#area')!)?.id).toBe('own');
  });
  test('is null where the only box is in a nested area', () => {
    const root = mount('<div data-kb-content-area id="area"><div data-kb-content-area><div data-kb-words-box></div></div></div>');
    expect(bodyModule.wordsBoxOf(root.querySelector<HTMLElement>('#area')!)).toBeNull();
  });
});
