/**
 * The Strategy Guide at /guide (the onboarding plan's Task 8; the design's sections 8 and 10; boards
 * docs/research/2026-11-02-onboarding/02-guide.html and 04-phone.html): the instance's Markdown, its markers filled from the live
 * instance and its numbers from the live settings, with contents that stay in view and mark the section on screen. What a class shows is
 * the class card's own entry (its description, its marks), and only the hint is the guide's.
 */
import fs from 'node:fs';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardUi } from '../cards/types.ts';
import type { Instance } from '../../rules/types.ts';
import type { ScreenSettings } from '../data/api.ts';
import { buildWorld, renderIn, renderInWorld, testInstance } from '../test-world.tsx';
import type { ClassLook, GuideUi } from '../types.ts';
import { Guide, GuideScreen } from './Guide.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const HINTS = { face: 'Get behind the posts you like.', heel: 'Being hated is a living.' };
const guide = (markdown: string): GuideUi => ({ markdown, hints: HINTS });
const instance: Instance = { ...testInstance, developer: { name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' } };

interface Options { readonly path?: string; readonly settings?: Partial<ScreenSettings>; readonly cards?: readonly CardUi[] }
const page = (markdown: string, o: Options = {}) =>
  renderInWorld(<Guide />, { path: o.path ?? '/guide', instance, guide: guide(markdown), ...(o.settings ? { settings: o.settings } : {}), ...(o.cards ? { cards: o.cards } : {}) });

const sectionOf = (title: string) => screen.getByRole('region', { name: title });
const contents = () => screen.getByRole('navigation', { name: 'Guide contents' });

/** A stand-in for the browser's observer, which jsdom lacks: it keeps what is watched, and the test says what comes into view. */
function stubObserver() {
  const watched = new Set<Element>();
  let callback: IntersectionObserverCallback = () => {};
  class Observer {
    constructor(cb: IntersectionObserverCallback) { callback = cb; }
    observe(el: Element) { watched.add(el); }
    unobserve(el: Element) { watched.delete(el); }
    disconnect() { watched.clear(); }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  return {
    watched,
    see: (el: Element, isIntersecting = true) => act(() => { callback([{ target: el, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver); }),
  };
}

describe('the contents and the sections', () => {
  test('every second-level heading is a section with an anchor, and the contents link to each; a third-level heading is not one', () => {
    page('## Welcome letter\n\nA.\n\n## Turns and reveals\n\nB.\n\n### Not a section\n\nC.');
    const links = within(contents()).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Welcome letter', 'Turns and reveals']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/guide#welcome-letter', '/guide#turns-and-reveals']);
    expect(document.getElementById('welcome-letter')).toBe(sectionOf('Welcome letter'));
    expect(document.getElementById('turns-and-reveals')).toBe(sectionOf('Turns and reveals'));
    expect(screen.getByRole('heading', { level: 3, name: 'Not a section' })).toBeInTheDocument();
    expect(within(contents()).queryByText('Not a section')).toBeNull();
  });

  test('two sections of one title get two anchors', () => {
    page('## Cards\n\nA.\n\n## Cards\n\nB.');
    expect(within(contents()).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/guide#cards', '/guide#cards-2']);
  });

  test('the page is headed Strategy Guide and says whose voice it is, and that every fact is true and every number today\'s', () => {
    page('## One\n\nA.');
    expect(screen.getByRole('heading', { level: 1, name: 'Strategy Guide' })).toBeInTheDocument();
    expect(screen.getByText(/The voice is Gabe's; every fact in it is true, and every number is today's\./u)).toBeInTheDocument();
  });

  test('opened at a fragment, the page scrolls that section into view', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    page('## One\n\nA.\n\n## Classes\n\nB.', { path: '/guide#classes' });
    expect(scroll).toHaveBeenCalled();
    expect(scroll.mock.contexts.at(-1)).toBe(sectionOf('Classes'));
  });

  test('the contents mark the section on screen, and move the mark as another comes into view', () => {
    const observer = stubObserver();
    page('## One\n\nA.\n\n## Two\n\nB.\n\n## Three\n\nC.');
    const link = (name: string) => within(contents()).getByRole('link', { name });
    /* Before anything is seen, the first is the one. */
    expect(link('One')).toHaveAttribute('aria-current', 'location');
    expect([...observer.watched]).toEqual([sectionOf('One'), sectionOf('Two'), sectionOf('Three')]);
    observer.see(sectionOf('One'), false);
    observer.see(sectionOf('Two'));
    expect(link('Two')).toHaveAttribute('aria-current', 'location');
    expect(link('One')).not.toHaveAttribute('aria-current');
    expect(link('Three')).not.toHaveAttribute('aria-current');
    /* Two on screen at once: the one nearer the top. */
    observer.see(sectionOf('Three'));
    expect(link('Two')).toHaveAttribute('aria-current', 'location');
    observer.see(sectionOf('Two'), false);
    expect(link('Three')).toHaveAttribute('aria-current', 'location');
    /* Nothing in the band between two sections: the mark stays where it was. */
    observer.see(sectionOf('Three'), false);
    expect(link('Three')).toHaveAttribute('aria-current', 'location');
  });

  test('on a phone the contents are a menu: a button names the section and opens the list, and choosing a section closes it', async () => {
    const user = userEvent.setup();
    page('## One\n\nA.\n\n## Two\n\nB.');
    const button = screen.getByRole('button', { name: /Contents/u });
    expect(button).toHaveTextContent(/One/u);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(contents()).getByRole('link', { name: 'Two' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent(/Two/u);
  });

  test('choosing a section in the open menu moves the focus to that section\'s heading, so it does not fall to the page', async () => {
    const user = userEvent.setup();
    page('## One\n\nA.\n\n## Two\n\nB.');
    await user.click(screen.getByRole('button', { name: /Contents/u }));
    await user.click(within(contents()).getByRole('link', { name: 'Two' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Two' })).toHaveFocus();
  });

  test('Escape closes the open menu and gives the focus back to its button', async () => {
    const user = userEvent.setup();
    page('## One\n\nA.');
    const button = screen.getByRole('button', { name: /Contents/u });
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });
});

describe('the Markdown', () => {
  test('is drawn as elements: bold, italic, a list, a table and a link are real ones', () => {
    page('## One\n\nA **bold** and *soft* word with [a link](/vending).\n\n- first\n- second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    const one = sectionOf('One');
    expect(within(one).getByText('bold').tagName).toBe('STRONG');
    expect(within(one).getByText('soft').tagName).toBe('EM');
    expect(within(one).getByRole('link', { name: 'a link' })).toHaveAttribute('href', '/vending');
    expect(within(one).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['first', 'second']);
    expect(within(one).getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
    expect(within(one).getByRole('cell', { name: '2' })).toBeInTheDocument();
  });

  test('raw HTML is shown as the text it is, and nothing in it runs or becomes markup', () => {
    const { container } = page('## One\n\n<script>window.hacked = true</script> and <b>bold?</b> and <img src=x onerror="window.hacked = true">');
    expect(within(sectionOf('One')).getByText(/<script>window\.hacked = true<\/script> and <b>bold\?<\/b> and <img src=x/u)).toBeInTheDocument();
    expect(container.querySelector('script, img, b')).toBeNull();
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  test('a link with an address that runs code is its words alone', () => {
    page('## One\n\n[click me](javascript:window.hacked=1) and [fine](https://dw.gripe/x)');
    const one = sectionOf('One');
    expect(within(one).queryByRole('link', { name: 'click me' })).toBeNull();
    expect(one).toHaveTextContent('click me and fine');
    expect(within(one).getByRole('link', { name: 'fine' })).toHaveAttribute('href', 'https://dw.gripe/x');
  });

  test('a marker the engine does not know draws nothing, and the rest of the page is there', () => {
    page('## One\n\nBefore.\n\n<!-- kayfabb:nonsense -->\n\nAfter.');
    expect(sectionOf('One')).toHaveTextContent('Before.After.');
  });
});

describe('the numbers', () => {
  const md = '## Aura\n\nUp to {{setting:charactersPerPlayer}} characters, a wallet of {{setting:walletCap}} orbs, a Turn every {{setting:turnCooldown}}.';
  test('are the live settings, said as the HUD says them', () => {
    page(md);
    expect(sectionOf('Aura')).toHaveTextContent('Up to 3 characters, a wallet of 6.00 orbs, a Turn every 30 days.');
  });
  test('change on the page when the settings change', () => {
    page(md, { settings: { charactersPerPlayer: 9, walletCap: 850, turnCooldown: { unit: 'day', count: 7 } } });
    expect(sectionOf('Aura')).toHaveTextContent('Up to 9 characters, a wallet of 8.50 orbs, a Turn every 7 days.');
  });
  test('a path the settings do not have is a dash, never a made-up number', () => {
    page('## Aura\n\nA {{setting:nope}} here.');
    expect(sectionOf('Aura')).toHaveTextContent('A — here.');
  });
});

describe('the welcome letter marker', () => {
  test('draws the instance\'s letter, so it is written once, its headings one level down', () => {
    page('## Welcome letter\n\n<!-- kayfabb:letter -->');
    expect(within(sectionOf('Welcome letter')).getByText('A letter.')).toBeInTheDocument();
  });
});

describe('the reaction grid marker', () => {
  test('lays the instance\'s reactions out as the picker does: excited above calm, negative left of positive, each corner named', () => {
    page('## Reactions\n\n<!-- kayfabb:reactions -->');
    const grid = within(sectionOf('Reactions')).getByRole('table', { name: 'The reaction grid' });
    expect(within(grid).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Negative', 'Positive']);
    const rows = within(grid).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['Excited', 'Calm']);
    const text = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent);
    expect(text(rows[0]!)).toEqual(['HeatT', 'HypeF']);
    expect(text(rows[1]!)).toEqual(['GroanZ', 'CalmE']);
  });
});

describe('the classes marker', () => {
  test('shows each class: its name, its own description, its hint, and no other class\'s', () => {
    page('## Classes\n\n<!-- kayfabb:classes -->');
    const classes = sectionOf('Classes');
    const face = within(classes).getByRole('group', { name: 'Face' });
    expect(within(face).getByText('The crowd favorite: earns from cheers. Hurt by boos.')).toBeInTheDocument();
    expect(within(face).getByText(HINTS.face)).toBeInTheDocument();
    expect(within(face).queryByText(HINTS.heel)).toBeNull();
    const heel = within(classes).getByRole('group', { name: 'Heel' });
    expect(within(heel).getByText('Earns heat: boos and tomatoes. Hurt by the polite shrug.')).toBeInTheDocument();
    expect(within(heel).getByText(HINTS.heel)).toBeInTheDocument();
  });

  test('a class\'s description is told the settlement span in force, as the class cards are (#179)', () => {
    const looks: Readonly<Record<string, ClassLook>> = { face: { color: 'currentColor', description: (_e, span) => `Counts per window of ${span.count} ${span.unit}.`, hurtsBy: () => 'Hurt by nothing.', marks: { label: 'Face marks', earns: [], hurts: [] } } };
    renderInWorld(<Guide />, { path: '/guide', instance, guide: guide('## Classes\n\n<!-- kayfabb:classes -->'), settings: { settlementLength: { unit: 'week', count: 1 } }, classLooks: looks });
    expect(within(screen.getByRole('group', { name: 'Face' })).getByText('Counts per window of 1 week. Hurt by nothing.')).toBeInTheDocument();
  });

  test('the hint is labeled as Gabe\'s, in words and not by color', () => {
    page('## Classes\n\n<!-- kayfabb:classes -->');
    expect(within(screen.getByRole('group', { name: 'Face' })).getByText("Gabe's hint")).toBeInTheDocument();
  });

  test('the Face\'s grid marks excited-positive as earned and bored-negative as hurt, as its class card does', () => {
    page('## Classes\n\n<!-- kayfabb:classes -->');
    const marks = within(screen.getByRole('group', { name: 'Face' })).getByRole('img', { name: 'Earns from hype, hurt by the groan' });
    /* Top row excited, bottom calm; left negative, right positive: heat, hype, groan, calm. */
    expect([...marks.children].map((c) => c.getAttribute('data-kb-mark'))).toEqual([null, 'earns', 'hurts', null]);
  });

  test('the Heel\'s grid marks excited-negative as earned and calm-positive as hurt', () => {
    page('## Classes\n\n<!-- kayfabb:classes -->');
    const marks = within(screen.getByRole('group', { name: 'Heel' })).getByRole('img', { name: 'Earns from heat, hurt by the calm' });
    expect([...marks.children].map((c) => c.getAttribute('data-kb-mark'))).toEqual(['earns', null, null, 'hurts']);
  });

  test('says the axes in words, and what a plus, a minus and a dotted cell are', () => {
    page('## Classes\n\n<!-- kayfabb:classes -->');
    const classes = sectionOf('Classes');
    expect(within(classes).getByText('Top row excited, bottom row calm; left negative, right positive.')).toBeInTheDocument();
    const legend = within(classes).getByRole('list', { name: 'The marks' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['+earns', '−hurts', 'earns by calling where a post ends up', 'earns from the balance between two (the smaller side)']);
  });

  test('wears the class\'s own colors, by its key', () => {
    page('## Classes\n\n<!-- kayfabb:classes -->');
    expect(screen.getByRole('group', { name: 'Face' }).style.getPropertyValue('--kb-class-fill')).toBe('var(--kb-glass-class-face-fill)');
  });
});

describe('the cards marker', () => {
  const whoops: CardUi = {
    key: 'whoops', describe: () => 'Long words with numbers 1.00.', summary: 'Splats a post in your ink.',
    art: { color: '#ff3d7f', ink: '#14030a', canvas: '', mark: '', tagline: 'Splat a post in ink.', credit: 'Test' },
  };
  test('lists each card with its rarity, its play, its flavor and what it does', () => {
    page('## Cards\n\n<!-- kayfabb:cards -->', { cards: [whoops] });
    const table = within(sectionOf('Cards')).getByRole('table', { name: 'The cards' });
    const row = within(table).getByRole('row', { name: /Whoops!/u });
    expect(within(row).getByRole('rowheader')).toHaveTextContent('Whoops!');
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['Salty Common', 'Cast', '1.00', 'Splat a post in ink. Splats a post in your ink.']);
  });

  test('its play is said in the instance\'s kind words, as its face says it', () => {
    renderInWorld(<Guide />, { path: '/guide', instance, guide: guide('## Cards\n\n<!-- kayfabb:cards -->'), cards: [whoops], copy: { cardKinds: { cast: 'Move', set: 'Gimmick', use: 'Ward' } } });
    const row = within(within(sectionOf('Cards')).getByRole('table', { name: 'The cards' })).getByRole('row', { name: /Whoops!/u });
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('Move');
  });
  test('each stacked label is its column\'s name: the head row says what every data-kb-label says', () => {
    page('## Cards\n\n<!-- kayfabb:cards -->', { cards: [whoops] });
    const table = within(sectionOf('Cards')).getByRole('table', { name: 'The cards' });
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    const labels = [...table.querySelectorAll('tbody td')].map((td) => td.getAttribute('data-kb-label'));
    expect(heads.slice(1)).toEqual(labels);
  });
  test('stacked under 56em the table keeps its table semantics: only the rows are laid out as a grid', () => {
    const css = fs.readFileSync('engine/ui/guide/guide.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const stacked = css.slice(css.indexOf('@container (max-width: 56em)'));
    const blocked: string[] = [];
    for (const m of stacked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/display:\s*block/u.test(m[2]!)) continue;
      blocked.push(...m[1]!.split(',').map((x) => x.replace(/\s+/gu, ' ').replace(/^@container[^{]*\{/u, '').trim()));
    }
    /* A block table, row group, row, header or cell is no table to a reader (browsers drop the role with the display). */
    expect(blocked.filter((x) => /^\.kb-guide-cards( tbody( tr| th| td)?)?$/u.test(x))).toEqual([]);
  });
  test('the price is the economy\'s the server prices with now, as the Vending Machine shows it', () => {
    page('## Cards\n\n<!-- kayfabb:cards -->', { cards: [whoops], settings: { cardEconomy: { 'whoops.price': 250 } } });
    expect(within(screen.getByRole('row', { name: /Whoops!/u })).getByRole('cell', { name: '2.50' })).toBeInTheDocument();
  });
  test('a card the instance gave no face is listed all the same, by its name and its rules', () => {
    page('## Cards\n\n<!-- kayfabb:cards -->');
    const row = screen.getByRole('row', { name: /Whoops!/u });
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Salty Common', 'Cast', '1.00', '']);
  });
});

describe('the page at /guide', () => {
  test('signed out, it is the board\'s sign-in prompt and no guide, as the Updates page is', async () => {
    const fake = buildWorld(undefined, instance);
    renderIn(fake, <GuideScreen />, { path: '/guide', instance, guide: guide('## One\n\nSecret text.') });
    expect(await screen.findByText(/The board is for players\./u)).toBeInTheDocument();
    expect(screen.queryByText('Secret text.')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Guide contents' })).toBeNull();
  });
  test('signed in, it is the guide', async () => {
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <GuideScreen />, { path: '/guide', instance, guide: guide('## One\n\nSecret text.') });
    expect(await screen.findByText('Secret text.')).toBeInTheDocument();
  });
});

describe('the look', () => {
  const css = fs.readFileSync('engine/ui/guide/guide.css', 'utf8');
  test('the contents stay in view on the Main board\'s layout, and fold into a menu on the Phone board\'s', () => {
    expect(/\.kb-guide-side\s*\{[^}]*position:\s*sticky/u.test(css)).toBe(true);
    expect(css).toMatch(/:where\(:root\[data-kb-layout='phone'\]\)[^{]*\.kb-guide-contents[^{]*\{/u);
  });
  test('the contents are a stacked list on the Main board\'s layout, and the columns stand clear of the heading', () => {
    const rule = (sel: string) => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()'=:]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? '';
    expect(rule('.kb-guide-toc')).not.toMatch(/overflow|display:\s*flex/u);
    expect(rule('.kb-guide-toc li')).not.toMatch(/display:\s*inline|flex:/u);
    expect(rule('.kb-guide-cols')).toMatch(/margin-top:\s*28px/u);
  });
  test('the mark on the section on screen is the neon along the left edge, as the Updates archive marks its current one', () => {
    expect(/\[aria-current='location'\][^{]*\{[^}]*inset 3px 0 0 var\(--kb-glass-neon\)/u.test(css)).toBe(true);
  });
  test('a section stops short of the top of the window when it is scrolled to', () => {
    expect(css).toMatch(/\.kb-guide-section\s*\{[^}]*scroll-margin-top/u);
  });
});
