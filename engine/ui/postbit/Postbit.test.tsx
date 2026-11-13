import { readFileSync } from 'node:fs';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Character, ShownTrophy } from '../data/api.ts';
import { widthOf } from '../test-width.ts';
import { renderInWorld } from '../test-world.tsx';
import { monthYear, shortDate } from './dates.ts';
import { Postbit, Signature, type PostbitPerson } from './Postbit.tsx';
import { reveals } from './reveals.ts';
import { axeViolations, describeViolations } from '../a11y.ts';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import { START } from '../data/fake.ts';

const character = (over: Partial<Character> = {}): Character => ({
  id: 'c1', name: 'Pipewrench', title: 'Professional Wrench', signature: '', avatarSquare: 'sq.webp', avatarPortrait: 'tall.webp',
  squareFrame: null, portraitFrame: null, portraitTallness: null, outfit: [], trophies: [], pipStyle: 'default', pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '2026-10-01', group: 'members', ...over,
});
const person = (over: Partial<PostbitPerson> = {}, c: Partial<Character> = {}): PostbitPerson => ({
  character: character(c), posts: 212, standing: 650, revealed: null, turnedAt: null, ...over,
});
const show = (p: PostbitPerson, layout: 'side' | 'stacked' = 'side') => renderInWorld(<Postbit person={p} layout={layout} />, { settings: { groups: GROUPS } });
/* The groups the screens hold (screen_settings.groups): the ladder lowest first, then the groups a move confers. */
const GROUPS = [
  { key: 'members', name: 'Members', badge: 'Member', color: '#7a7a7a', stripe: false, staff: false },
  { key: 'cores', name: 'Test Cores', color: '#d4a017', stripe: false, staff: true },
  { key: 'trialMembers', name: 'Trial Members', badge: 'Trial Member', color: '#d2691e', stripe: true, staff: false },
];
/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const slot = () => document.querySelector('.kb-postbit-avatar')!;

afterEach(() => vi.unstubAllGlobals());

describe('the stacked postbit', () => {
  test('drops Posts and Joined, which the profile carries a tap away', () => {
    show(person(), 'stacked');
    const bit = screen.getByRole('group', { name: 'About Pipewrench' });
    expect(bit).not.toHaveTextContent(/Posts|Joined/u);
    expect(bit).toHaveTextContent('Professional Wrench');
  });

  test('a phone stacks whatever the reader chose, so it drops them too, and a wide side by side keeps them', () => {
    widthOf(390);
    show(person(), 'side');
    expect(screen.getByRole('group')).not.toHaveTextContent(/Posts|Joined/u);
  });

  test('a wide window keeps them in the side by side layout', () => {
    widthOf(1440);
    show(person(), 'side');
    expect(screen.getByRole('group')).toHaveTextContent('Posts: 212');
  });
});

describe('the postbit', () => {
  test('name, title, posts and the month joined, never the day', () => {
    show(person());
    const bit = screen.getByRole('group', { name: 'About Pipewrench' });
    expect(within(bit).getByText('Pipewrench')).toBeInTheDocument();
    expect(within(bit).getByText('Professional Wrench')).toBeInTheDocument();
    expect(bit).toHaveTextContent('Posts: 212');
    expect(bit).toHaveTextContent('Joined Oct 2026');
    expect(bit).not.toHaveTextContent('Oct 1,');
  });

  test('the name links to the character\'s public profile', () => {
    show(person());
    expect(screen.getByRole('link', { name: 'Pipewrench' })).toHaveAttribute('href', '/c/c1');
  });

  test('link={false} draws the name as text, with no link to a profile behind it', () => {
    renderInWorld(<Postbit person={person()} layout="side" link={false} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'About Pipewrench' })).getByText('Pipewrench')).toBeInTheDocument();
  });

  test('side by side puts the portrait in the tall slot, with the square for a phone', () => {
    show(person());
    expect(screen.getByRole('group')).toHaveAttribute('data-kb-postbit', 'side');
    expect(slot().querySelector('img')).toHaveAttribute('src', 'tall.webp');
    expect(slot().querySelector('source')).toHaveAttribute('srcset', 'sq.webp');
  });

  test('a real portrait is marked as one, so its slot can take the portrait\'s own shape', () => {
    show(person());
    expect(slot()).toHaveAttribute('data-kb-slot', 'portrait');
  });

  test('the square fills the tall slot where there is no portrait', () => {
    show(person({}, { avatarPortrait: null }));
    expect(slot().querySelector('img')).toHaveAttribute('src', 'sq.webp');
    expect(slot()).toHaveAttribute('data-kb-slot', 'tall');
  });

  test('stacked uses the square, and never loads the portrait', () => {
    show(person(), 'stacked');
    expect(screen.getByRole('group')).toHaveAttribute('data-kb-postbit', 'stacked');
    expect(slot().querySelector('img')).toHaveAttribute('src', 'sq.webp');
    expect(slot().querySelector('source')).toBeNull();
  });

  test('no avatar at all shows the initial, which is decoration', () => {
    show(person({}, { avatarSquare: null, avatarPortrait: null }));
    expect(slot().querySelector('img')).toBeNull();
    expect(slot()).toHaveTextContent('P');
    expect(slot()).toHaveAttribute('aria-hidden', 'true');
    /* The tall slot is for a portrait, or a square standing in for one: never an empty tall box. */
    expect(slot()).toHaveAttribute('data-kb-slot', 'square');
  });

  test('the rank is the highest whose threshold the standing reaches, with that many pips filled', () => {
    show(person({ standing: 650 }));
    expect(screen.getByText('Main Eventer')).toBeInTheDocument();
    const pips = screen.getByRole('img', { name: 'Rank 3 of 3: Main Eventer' });
    expect(pips.querySelectorAll('.kb-pip')).toHaveLength(3);
    expect(pips.querySelectorAll('.kb-pip[data-kb-filled]')).toHaveLength(3);
  });

  test('a standing short of every threshold but the first is the first rank; none yet is the same', () => {
    const { unmount } = show(person({ standing: 299 }));
    expect(screen.getByRole('img', { name: 'Rank 1 of 3: Jobber' }).querySelectorAll('.kb-pip[data-kb-filled]')).toHaveLength(1);
    unmount();
    show(person({ standing: null }));
    expect(screen.getByRole('img', { name: 'Rank 1 of 3: Jobber' })).toBeInTheDocument();
  });

  test('the pips are drawn from the character\'s pip style, the default where the style is unknown', () => {
    show(person({}, { pipStyle: 'gone' }));
    const row = screen.getByRole('img', { name: /^Rank/ });
    expect(row.getAttribute('style')).toContain('full.svg');
    expect(row.getAttribute('style')).toContain('empty.svg');
  });

  test('nothing about a class unless its player made it public', () => {
    show(person());
    expect(screen.getByRole('group')).not.toHaveTextContent(/Revealed|Turned/);
  });

  test('a revealed class, dated', () => {
    show(person({ revealed: { class: 'heel', at: '2026-10-03T15:00:00Z' } }));
    expect(screen.getByRole('group')).toHaveTextContent('Revealed: Heel (Oct 3)');
  });

  test('and "Has Turned since" when a later announced Turn came after it', () => {
    show(person({ revealed: { class: 'heel', at: '2026-10-03T15:00:00Z' }, turnedAt: '2026-10-20T15:00:00Z' }));
    const bit = screen.getByRole('group');
    expect(bit).toHaveTextContent('Revealed: Heel (Oct 3)');
    expect(bit).toHaveTextContent('Has Turned since (Oct 20)');
  });

  test('the signature is BBCode', () => {
    renderInWorld(<Signature text="i fix things. [b]sometimes[/b] they were working." />);
    expect(document.querySelector('.kb-signature strong')).toHaveTextContent('sometimes');
  });
});

describe('reveals(): which statement of its class a character has made', () => {
  const rev = (character: string, cls: string, at: string) => ({ act: `${character}${at}`, character, class: cls, at, via: 'act' as const, thread: 't' });
  const turn = (character: string, at: string) => ({ act: `${character}${at}`, character, at, was: null, since: null });
  test('the latest reveal, and only a Turn after it', () => {
    const out = reveals(
      [rev('a', 'face', '2026-09-01T00:00:00Z'), rev('a', 'heel', '2026-10-03T00:00:00Z'), rev('b', 'face', '2026-10-05T00:00:00Z')],
      [turn('a', '2026-09-15T00:00:00Z'), turn('a', '2026-10-20T00:00:00Z'), turn('c', '2026-10-21T00:00:00Z')],
    );
    expect(out.get('a')).toEqual({ revealed: { class: 'heel', at: '2026-10-03T00:00:00Z' }, turnedAt: '2026-10-20T00:00:00Z' });
    expect(out.get('b')).toEqual({ revealed: { class: 'face', at: '2026-10-05T00:00:00Z' }, turnedAt: null });
    expect(out.has('c')).toBe(false);
  });
  test('a Turn from before the reveal, or at its moment, says nothing: there is no "Has Turned since"', () => {
    const out = reveals([rev('a', 'heel', '2026-10-03T00:00:00Z')], [turn('a', '2026-09-15T00:00:00Z'), turn('a', '2026-10-03T00:00:00Z')]);
    expect(out.get('a')).toEqual({ revealed: { class: 'heel', at: '2026-10-03T00:00:00Z' }, turnedAt: null });
  });
});

describe('dates', () => {
  test('the tests run in a zone that is not UTC, so a local date and a UTC date can differ', () => {
    expect(process.env.TZ).toBe('America/Los_Angeles');
    expect(new Date('2026-10-04T03:00:00Z').getDate()).toBe(3);
  });

  test('a reveal or Turn date is the reader\'s local date, like every time in a thread', () => {
    expect(shortDate('2026-10-04T03:00:00Z')).toBe('Oct 3');
    show(person({ revealed: { class: 'heel', at: '2026-10-04T03:00:00Z' }, turnedAt: '2026-11-01T02:00:00Z' }));
    expect(screen.getByRole('group')).toHaveTextContent('Revealed: Heel (Oct 3)');
    expect(screen.getByRole('group')).toHaveTextContent('Has Turned since (Oct 31)');
  });

  test('"Joined" is the calendar month the server gave, whatever the reader\'s zone', () => {
    expect(monthYear('2026-10-01')).toBe('Oct 2026');
    show(person({}, { joined: '2026-10-01' }));
    expect(screen.getByRole('group')).toHaveTextContent('Joined Oct 2026');
  });

  test('a date that cannot be read is nothing, and the postbit then says nothing about when it joined', () => {
    expect(monthYear('')).toBe('');
    expect(monthYear('not a date')).toBe('');
    show(person({}, { joined: '' }));
    expect(screen.getByRole('group')).not.toHaveTextContent(/Joined|undefined|NaN/u);
    expect(screen.getByRole('group')).toHaveTextContent('Posts: 212');
  });
});

describe('a staff character\'s postbit', () => {
  test('a Boss wears an ADMINISTRATOR badge and its title, and shows no rank, pips or class (a staff character is not scored)', () => {
    show(person({ standing: null }, { name: 'The Director', title: 'Head of Board Operations', staff: 'director', office: 'boss' }));
    const bit = screen.getByRole('group', { name: 'About The Director' });
    expect(within(bit).getByText('ADMINISTRATOR')).toBeInTheDocument();
    expect(bit).toHaveTextContent('Head of Board Operations');
    expect(bit).toHaveTextContent('Posts: 212');
    expect(within(bit).queryByRole('img', { name: /^Rank / })).toBeNull();
    expect(bit.querySelector('.kb-postbit-rank')).toBeNull();
  });

  test('draws no pips whatever the ranks are, and shows its name, badges, title, avatar, Posts and Joined', () => {
    widthOf(1440);
    show(person({ standing: 650 }, { name: 'The Director', title: 'Head of Board Operations', staff: 'director', office: 'boss' }));
    const bit = screen.getByRole('group', { name: 'About The Director' });
    expect(bit.querySelector('.kb-pips')).toBeNull();
    expect(bit.querySelector('.kb-pip')).toBeNull();
    expect(bit.querySelector('.kb-postbit-rank-name')).toBeNull();
    expect(within(bit).getByRole('link', { name: 'The Director' })).toBeInTheDocument();
    expect(within(bit).getByText('ADMINISTRATOR')).toBeInTheDocument();
    expect(bit).toHaveTextContent('Head of Board Operations');
    expect(bit.querySelector('.kb-postbit-avatar')).not.toBeNull();
    expect(bit).toHaveTextContent('Posts: 212');
    expect(bit).toHaveTextContent('Joined Oct 2026');
  });

  test('a Mod Bot wears MODERATOR', () => {
    show(person({}, { name: 'Hall Monitor', staff: 'hall-monitor', office: 'mod' }));
    const bit = screen.getByRole('group', { name: 'About Hall Monitor' });
    expect(within(bit).getByText('MODERATOR')).toBeInTheDocument();
    expect(within(bit).queryByText('ADMINISTRATOR')).toBeNull();
  });

  test('a member or a benched persona wears no badge', () => {
    show(person({}, { name: 'Retired Boss', staff: 'retired-boss', office: 'member' }));
    expect(screen.queryByText('MODERATOR')).toBeNull();
    expect(screen.queryByText('ADMINISTRATOR')).toBeNull();
  });

  test('an ordinary character wears no badge', () => {
    show(person());
    expect(screen.queryByText('ADMINISTRATOR')).toBeNull();
    expect(screen.queryByText('MODERATOR')).toBeNull();
  });
});

describe('the warn meter and BANNED (the Mod Bots design, section 9)', () => {
  const meter = (n: number) => screen.queryByRole('img', { name: `Warnings: ${n}/10` });

  test('"Warnings: 6/10" is the meter\'s accessible name, over an 84 by 16 thermometer filled to 6 of 10', () => {
    show(person({}, { warnPoints: 6 }));
    const m = meter(6)!;
    expect(m).toBeInTheDocument();
    expect(m).toHaveTextContent('Warnings: 6/10');
    const svg = m.querySelector('svg')!;
    expect([svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox')]).toEqual(['84', '16', '0 0 84 16']);
    /* The tube is white with a black outline, the bulb and the fill are the house red token, and the fill reaches 6 of 10 of the tube. */
    const [tube, fill, bulb] = [...svg.querySelectorAll('rect, circle')] as SVGElement[];
    expect(tube!.getAttribute('style')).toContain('var(--kb-warn-tube)');
    expect(tube!.getAttribute('style')).toContain('var(--kb-warn-outline)');
    expect(fill!.getAttribute('style')).toContain('var(--kb-warn-fill)');
    expect(bulb!.getAttribute('style')).toContain('var(--kb-warn-fill)');
    const tubeLength = Number(tube!.getAttribute('width')) - 1;
    expect(Number(fill!.getAttribute('width'))).toBeCloseTo(tubeLength * 0.6, 1);
  });

  test('the fill grows with the points, and a full bar fills the tube', () => {
    const { unmount } = show(person({}, { warnPoints: 2 }));
    const two = Number(meter(2)!.querySelectorAll('rect')[1]!.getAttribute('width'));
    unmount();
    show(person({}, { warnPoints: 9 }));
    expect(Number(meter(9)!.querySelectorAll('rect')[1]!.getAttribute('width'))).toBeGreaterThan(two * 4);
  });

  test('a character with no points shows no meter', () => {
    show(person());
    expect(screen.queryByRole('img', { name: /^Warnings/u })).toBeNull();
    expect(document.querySelector('.kb-postbit-thermo')).toBeNull();
  });

  test('a staff character shows none', () => {
    show(person({}, { warnPoints: 4, staff: 'clerk', office: 'mod' }));
    expect(screen.queryByRole('img', { name: /^Warnings/u })).toBeNull();
  });

  test('BANNED is on the title line while the ban holds, with when it ends for a screen reader', () => {
    show(person({}, { bannedUntil: new Date(START + 3_600_000).toISOString() }));
    const title = document.querySelector('.kb-postbit-title')!;
    expect(title).toHaveTextContent('Professional Wrench BANNED');
    expect(title.querySelector('.kb-visually-hidden')?.textContent).toMatch(/^ until /u);
  });

  test('BANNED stands alone where the character has no title, and is gone once the ban has ended', () => {
    const { unmount } = show(person({}, { title: '', bannedUntil: new Date(START + 3_600_000).toISOString() }));
    expect(document.querySelector('.kb-postbit-title')).toHaveTextContent('BANNED');
    unmount();
    show(person({}, { bannedUntil: new Date(START - 1000).toISOString() }));
    expect(screen.queryByText('BANNED')).toBeNull();
  });

  test('passes axe with the meter and BANNED drawn', async () => {
    show(person({}, { warnPoints: 6, bannedUntil: new Date(START + 3_600_000).toISOString() }));
    const bad = await axeViolations(screen.getByRole('group', { name: 'About Pipewrench' }));
    expect(bad, describeViolations(bad)).toEqual([]);
  });
});

describe('the stand-in (card notes, Part 3)', () => {
  /* The character a card's veil shows in place of a post's author: office `anonymous`. It wears no badge, no warn meter and no group bar, whatever its group and points say. */
  const standIn = (over: Partial<Character> = {}) => person({ standing: null }, { name: 'Nobody', title: 'Could be anyone.', office: 'anonymous', group: 'cores', warnPoints: 6, ...over });

  test('draws its name and title like any character\'s, and no staff badge, no warn meter and no group bar', () => {
    show(standIn({ staff: 'anonymous' }));
    const bit = screen.getByRole('group', { name: 'About Nobody' });
    expect(within(bit).getByText('Nobody')).toBeInTheDocument();
    expect(within(bit).getByText('Could be anyone.')).toBeInTheDocument();
    expect(bit.querySelector('.kb-staff-badge')).toBeNull();
    expect(within(bit).queryByRole('img', { name: /^Warnings/u })).toBeNull();
    expect(bit.querySelector('.kb-group-bar')).toBeNull();
    expect(bit.querySelector('.kb-postbit-group')).toBeNull();
  });

  test('with no staff key at all it is still unscored: no rank, no pips and no meter, no bar', () => {
    show(standIn({ group: 'members' }));
    const bit = screen.getByRole('group', { name: 'About Nobody' });
    expect(bit.querySelector('.kb-group-bar')).toBeNull();
    expect(within(bit).queryByRole('img', { name: /^Warnings/u })).toBeNull();
    expect(bit.querySelector('.kb-postbit-rank')).toBeNull();
  });

  test('an ordinary character in the same group still wears its bar', () => {
    show(person({}, { group: 'members' }));
    expect(document.querySelector('.kb-group-bar')).not.toBeNull();
  });
});

describe('the side by side avatar slot, in the stylesheet', () => {
  const css = readFileSync('engine/ui/postbit/postbit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  /* The declarations of the first rule whose selector contains `selector`, in any media block. */
  const rule = (selector: string) => {
    const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => m[1]!.split(',').some((x) => x.trim().endsWith(selector.replace(/ \{$/u, ''))));
    return found.length === 0 ? null : found.map((m) => m[2]!).join('');
  };

  /* A portrait is any shape from 1:1 to 1:2 (profile-edit/frames.ts). A slot fixed at 1:2 with `cover` crops every
     portrait shorter than that, so the slot must take the picture's own shape once it loads. */
  test('a portrait\'s slot takes the portrait\'s own shape, not a fixed 1:2 crop', () => {
    expect(rule('.kb-postbit-avatar[data-kb-slot="portrait"] {')).toMatch(/aspect-ratio:\s*auto\s*;/u);
    expect(rule('.kb-postbit-avatar[data-kb-slot="portrait"] > picture > img')).toMatch(/aspect-ratio:\s*auto 1 \/ 2\s*;/u);
    expect(rule('.kb-postbit-avatar[data-kb-slot="portrait"] > picture > img')).toMatch(/height:\s*auto\s*;/u);
  });

  test('the phone keeps its small square, which the portrait\'s rules must not reach', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 40em)'));
    expect(css).toMatch(/@media not all and \(max-width: 40em\)\s*\{[^@]*data-kb-slot="portrait"/u);
  });
});

describe('gear on the postbit', () => {
  const worn = [{ gear: 'band', x: 0.5, y: 0, w: 0.5, turn: 0, layer: 0 }];
  const SQUARE = { x: 0, y: 0, w: 1, h: 0.5 };

  test('a portrait wears its pieces in a layer of its own, hidden from assistive tech', () => {
    show(person({}, { outfit: worn, portraitTallness: 1.5 }));
    const layer = slot().querySelector('.kb-outfit')!;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.querySelectorAll('img')).toHaveLength(1);
    expect(slot().querySelector('picture img')).toHaveAttribute('src', 'tall.webp');
  });

  test('the tall slot takes the portrait\'s tallness as its aspect ratio', () => {
    show(person({}, { portraitTallness: 1.4 }));
    expect((slot() as HTMLElement).style.aspectRatio).toBe('1 / 1.4');
  });

  test('the stacked band and the phone draw the square, with the pieces cut through its frame', () => {
    show(person({}, { outfit: [{ ...worn[0]!, y: 0.25 }], squareFrame: SQUARE, portraitTallness: 2 }), 'stacked');
    expect(slot().querySelector('.kb-outfit')).toHaveAttribute('data-kb-on', 'square');
    expect(slot().querySelector<HTMLElement>('.kb-outfit img')!.style.top).toBe('50%');
  });

  test('a side by side portrait carries both layers in the DOM at every width, and the stylesheet shows one', () => {
    const outfit = [{ ...worn[0]!, y: 0.25 }];
    for (const w of [1440, 390]) {
      document.body.innerHTML = '';
      widthOf(w);
      show(person({}, { outfit, squareFrame: SQUARE, portraitTallness: 2 }));
      expect(slot()).toHaveAttribute('data-kb-slot', 'portrait');
      expect(slot().querySelector('.kb-outfit[data-kb-on="portrait"]')).not.toBeNull();
      expect(slot().querySelector('.kb-outfit[data-kb-on="square"]')).not.toBeNull();
    }
    const css = readFileSync('engine/ui/postbit/postbit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const phone = css.slice(css.indexOf('@media (max-width: 40em)'));
    expect(css).toMatch(/\.kb-outfit\[data-kb-on="square"\]\s*\{[^}]*display:\s*none/u);
    expect(phone).toMatch(/data-kb-square[^{]*\.kb-outfit\[data-kb-on="portrait"\]\s*\{[^}]*display:\s*none/u);
    expect(phone).toMatch(/\.kb-outfit\[data-kb-on="square"\]\s*\{[^}]*display:\s*block/u);
  });

  test('no rule hides the square outfit outside the side layout, and the phone crops the portrait slot with cover', () => {
    const css = readFileSync('engine/ui/postbit/postbit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const hides = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => /display:\s*none/u.test(m[2]!) && m[1]!.includes('data-kb-on="square"'));
    expect(hides.length).toBeGreaterThan(0);
    for (const m of hides) expect(m[1]).toContain('data-kb-postbit="side"');
    const phone = css.slice(css.indexOf('@media (max-width: 40em)'));
    expect(phone).toMatch(/data-kb-slot="portrait"\]\s*>\s*picture\s*>\s*img\s*\{[^}]*object-fit:\s*cover/u);
  });

  test('a mask with no portrait draws its square or initial and no gear', () => {
    show(person({}, { avatarPortrait: null, outfit: worn }));
    expect(slot().querySelector('.kb-outfit')).toBeNull();
  });

  test('a mask with a portrait and no gear draws no layer', () => {
    show(person({}, { outfit: [] }));
    expect(slot().querySelector('.kb-outfit')).toBeNull();
  });
});

describe('a portrait with no square', () => {
  const worn = [{ gear: 'band', x: 0.5, y: 0.1, w: 0.5, turn: 0, layer: 0 }];
  test('stacked, the square gear is not drawn over the initial letter', () => {
    show(person({}, { avatarSquare: null, outfit: worn, portraitTallness: 2 }), 'stacked');
    expect(slot().querySelector('.kb-outfit')).toBeNull();
    expect(slot()).toHaveTextContent('P');
  });

  test('on a phone its portrait gear is hidden, since the 1:1 cover slot is not the portrait\'s shape', () => {
    const css = readFileSync('engine/ui/postbit/postbit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const phone = css.slice(css.indexOf('@media (max-width: 40em)'));
    expect(phone).toMatch(/data-kb-slot="portrait"\]:not\(\[data-kb-square\]\)\s*>\s*\.kb-outfit\[data-kb-on="portrait"\]\s*\{[^}]*display:\s*none/u);
  });
});

describe('the post cells over the postbit\'s gear, in the stylesheet', () => {
  const strip = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  const css = strip('engine/ui/thread/thread.css');
  const decls = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => m[1]!.split(',').some((x) => x.trim() === sel)).map((m) => m[2]!).join('');
  const z = (d: string) => Number(/z-index:\s*(-?\d+)/u.exec(d)?.[1] ?? 'NaN');

  /*
   * Gear may reach right past the postbit's cell; the post's meta, words, actions and panels are cells on their own ground over it, so the text
   * always wins. The postbit goes under them (-1, in the post's own stacking context) rather than lifting them: a lifted line above would trap
   * the marks strip and the callout that hang from it over the words (thread.css). jsdom has no stacking: e2e/post-layers.spec.ts holds this
   * in a browser, and these hold the rules it rests on.
   */
  test('the post is a stacking context and the postbit\'s cell lies under the others at a negative level', () => {
    expect(decls('.kb-act')).toMatch(/isolation:\s*isolate/u);
    expect(z(decls('.kb-act > .kb-postbit'))).toBeLessThan(0);
    expect(z(decls('.kb-act-main'))).toBeGreaterThan(z(decls('.kb-act > .kb-postbit')));
  });

  test('the line above, the actions and the panels take no level, so what hangs from the line above stays in the post\'s stack', () => {
    for (const sel of ['.kb-act-meta', '.kb-act-foot', '.kb-act-panels']) expect(decls(sel), sel).not.toMatch(/z-index/u);
  });

  test('every post cell keeps the post ground the lift relies on', () => {
    expect(decls('.kb-act > *')).toMatch(/background:\s*var\(--kb-post-bg\)/u);
  });
});

describe('the postbit\'s phone block', () => {
  /* The slicing tests above take everything from the phone's media block to the end of the file: that is the phone's only if the block stays after the wide rules. */
  test('the phone block comes after the wide block', () => {
    const css = readFileSync('engine/ui/postbit/postbit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const wide = css.indexOf('@media not all and (max-width: 40em)');
    const phone = css.indexOf('@media (max-width: 40em)');
    expect(wide).toBeGreaterThan(-1);
    expect(phone).toBeGreaterThan(wide);
  });
});

describe('the postbit\'s text over the outfit, in the stylesheet', () => {
  const css = readFileSync('engine/ui/postbit/postbit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  const decls = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => m[1]!.split(',').some((x) => x.trim() === selector || x.trim().endsWith(` ${selector}`))).map((m) => m[2]!).join('');
  const z = (d: string) => Number(/z-index:\s*(-?\d+)/u.exec(d)?.[1] ?? 'NaN');

  test('the name, title, rank, trophies and counts are on a layer above the avatar slot, each run on the board\'s ground', () => {
    const text = decls('.kb-postbit[data-kb-postbit="side"] .kb-postbit-text > *');
    expect(z(text)).toBeGreaterThan(z(decls('.kb-postbit-avatar')));
    expect(text).toMatch(/background:\s*var\(--kb-post-bg,\s*var\(--kb-bg\)\)/u);
    expect(text).not.toMatch(/background:\s*var\(--kb-bg\)\s*;/u);
    expect(decls('.kb-postbit-avatar')).toMatch(/position:\s*relative/u);
  });

  test('the text-over-gear rule is scoped to wide windows and the phone side layout is not touched by it', () => {
    expect(css).toMatch(/@media not all and \(max-width: 40em\)\s*\{[^@]*\.kb-postbit-text > \*/u);
    const bare = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/gu, '');
    expect(bare).not.toMatch(/\.kb-postbit-text > \*/u);
  });

  test('the tall slot lets gear reach past its edge and does not crop the portrait', () => {
    const slot = decls('.kb-postbit-avatar[data-kb-slot="portrait"]');
    expect(slot).toMatch(/overflow:\s*visible/u);
    const wide = css.slice(0, css.indexOf('@media (max-width: 40em)'));
    const wideImg = [...wide.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => m[1]!.trim().endsWith('.kb-postbit-avatar[data-kb-slot="portrait"] > picture > img')).map((m) => m[2]!).join('');
    expect(wideImg).not.toMatch(/object-fit:\s*cover/u);
  });
});

describe('the group bar on the postbit', () => {
  test('a member shows its group\'s bar under the name and over the title, the pips and the warn meter', () => {
    show(person({}, { group: 'members', warnPoints: 4 }));
    const bit = screen.getByRole('group', { name: 'About Pipewrench' });
    const bar = within(bit).getByText('Member');
    expect(bar.className).toContain('kb-group-bar');
    expect(bar).not.toHaveAttribute('data-kb-stripe');
    expect(before(within(bit).getByRole('link', { name: 'Pipewrench' }), bar)).toBe(true);
    expect(before(bar, within(bit).getByText('Professional Wrench'))).toBe(true);
    expect(before(within(bit).getByText('Professional Wrench'), bit.querySelector('.kb-pips')!)).toBe(true);
    expect(before(bit.querySelector('.kb-pips')!, bit.querySelector('.kb-postbit-warn')!)).toBe(true);
    expect(before(bit.querySelector('.kb-postbit-warn')!, within(bit).getByText('Posts: 212'))).toBe(true);
  });

  test('a Trial Member\'s bar is striped, and BANNED sits under it with the title', () => {
    show(person({}, { group: 'trialMembers', bannedUntil: '2099-01-01T00:00:00Z' }));
    const bit = screen.getByRole('group', { name: 'About Pipewrench' });
    const bar = within(bit).getByText('Trial Member');
    expect(within(bit).queryByText('Trial Members')).toBeNull();
    expect(bar).toHaveAttribute('data-kb-stripe', '');
    expect(before(bar, within(bit).getByText('BANNED'))).toBe(true);
  });

  test('a staff postbit shows the staff rung\'s bar with the office title beside it, and the badge is the title alone', () => {
    show(person({ standing: null }, { name: 'The Director', title: 'Head of Board Operations', staff: 'director', office: 'boss', group: 'cores' }));
    const bit = screen.getByRole('group', { name: 'About The Director' });
    const bar = within(bit).getByText('Test Cores');
    const office = within(bit).getByText('ADMINISTRATOR');
    expect(bar.className).toContain('kb-group-bar');
    expect(bar.closest('.kb-postbit-group')).toBe(office.closest('.kb-postbit-group'));
    expect(bit.querySelector('.kb-staff-group')).toBeNull();
    expect(before(bar, within(bit).getByText('Head of Board Operations'))).toBe(true);
  });

  test('a character whose group the settings do not list gets no bar rather than a wrong one', () => {
    show(person({}, { group: 'gone' }));
    expect(document.querySelector('.kb-group-bar')).toBeNull();
  });
});

describe('trophies on the postbit', () => {
  const t = (award: string, trophy: string, name: string, over: Partial<ShownTrophy> = {}): ShownTrophy => ({ award, trophy, name, art: null, belt: false, held: false, ...over });
  const four = [t('a1', 'p1', 'First'), t('a2', 'p2', 'Second'), t('a3', 'p3', 'Third'), t('a4', 'met', 'Fourth')];
  const belt = t('b1', 'belt', 'Test Belt', { belt: true, held: true });
  const bit = () => screen.getByRole('group', { name: 'About Pipewrench' });

  test('a fourth chosen trophy is not drawn, though the answer carries it (shownMost is 3)', () => {
    widthOf(1440);
    show(person({}, { trophies: four }));
    expect(Array.from(bit().querySelectorAll('img.kb-trophy')).map((i) => i.getAttribute('alt'))).toEqual(['First', 'Second', 'Third']);
  });

  test('each is an image whose alt and title are its name, under the rank', () => {
    widthOf(1440);
    show(person({}, { trophies: [four[0]!] }));
    const img = within(bit()).getByAltText('First');
    expect(img).toHaveAttribute('title', 'First');
    expect(img).toHaveAttribute('src', 'p1.svg');
    expect(before(document.querySelector('.kb-postbit-rank')!, img)).toBe(true);
  });

  test('a held belt is drawn beside the three chosen, and does not use a place', () => {
    widthOf(1440);
    show(person({}, { trophies: [...four.slice(0, 3), belt] }));
    expect(Array.from(bit().querySelectorAll('img.kb-trophy')).map((i) => i.getAttribute('alt'))).toEqual(['First', 'Second', 'Third', 'Test Belt']);
  });

  test('a held belt is drawn on the stacked band, beside the name, and the chosen trophies are not', () => {
    show(person({}, { trophies: [...four, belt] }), 'stacked');
    const imgs = Array.from(bit().querySelectorAll('img.kb-trophy'));
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['Test Belt']);
    expect(imgs[0]!.closest('.kb-postbit-name')).not.toBeNull();
  });

  test('a phone draws the held belt only, whatever the reader chose', () => {
    widthOf(390);
    show(person({}, { trophies: [...four, belt] }), 'side');
    expect(Array.from(bit().querySelectorAll('img.kb-trophy')).map((i) => i.getAttribute('alt'))).toEqual(['Test Belt']);
  });

  test('a belt no longer held is only a trophy, and a postbit with none draws no row', () => {
    widthOf(1440);
    show(person({}, { trophies: [] }));
    expect(document.querySelector('.kb-postbit-trophies')).toBeNull();
  });

  test('the trophy row is a direct child of the text layer, so the ground rule above gear reaches it', () => {
    widthOf(1440);
    show(person({}, { trophies: four }));
    expect(document.querySelector('.kb-postbit-text > .kb-postbit-trophies')).not.toBeNull();
  });

  test('passes axe with trophies and a belt drawn', async () => {
    widthOf(1440);
    show(person({}, { trophies: [...four, belt] }));
    const bad = await axeViolations(bit());
    expect(bad, describeViolations(bad)).toEqual([]);
  });
});
