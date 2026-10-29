import { screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Act } from '../data/api.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { RevealPost, TallyPost } from './Reveal.tsx';

const OCT3 = '2026-10-03T12:00:00Z';
const OCT20 = '2026-10-20T12:00:00Z';

const actOf = (kind: 'tally' | 'reveal', payload: Record<string, unknown>): Act => ({
  id: 'a1', character: null, kind, thread: 't1', targetActId: null, seq: 1, createdAt: '2026-10-29T12:00:00Z',
  payload, currentPayload: payload, editedAt: null, shownEditedAt: null,
});

const reveal = (over: Record<string, unknown>) => actOf('reveal', { season: 1, character: 'c1', name: 'Pipewrench', place: 3, standing: 4170, shown: [], ...over });

function show(act: Act) {
  const fake = buildWorld();
  return renderIn(fake, act.kind === 'tally' ? <TallyPost act={act} /> : <RevealPost act={act} />, { path: '/' });
}

describe('a character\'s post in the season\'s reveal', () => {
  test('says its place, rank and standing, and links to its profile', async () => {
    show(reveal({ standing: 350, place: 2 }));
    const post = await screen.findByRole('region', { name: 'Pipewrench in the season\'s reveal' });
    expect(within(post).getByRole('link', { name: 'Pipewrench' })).toHaveAttribute('href', '/c/c1');
    expect(post).toHaveTextContent('finished #2');
    expect(post).toHaveTextContent('Midcarder');
    expect(post).toHaveTextContent('3.50');
  });

  test('the bar and its accessible description list each class its player made public, and their dates', async () => {
    show(reveal({
      shown: [
        { kind: 'turn', act: 'x', at: OCT20, was: 'face', since: '2026-10-01T12:00:00Z' },
        { kind: 'reveal', act: 'y', at: OCT3, class: 'heel', via: 'act' },
      ],
    }));
    const bar = await screen.findByRole('img', { name: /Classes its player made public/u });
    const described = bar.getAttribute('aria-label')!;
    expect(described).toContain('Face');
    expect(described).toContain('Oct 1');
    expect(described).toContain('Oct 20');
    expect(described).toContain('Heel');
    expect(described).toContain('Oct 3');
    /* The bar is a segment for each statement, patterned as well as colored. */
    expect(within(bar).getAllByText(/^(Face|Heel)$/u)).toHaveLength(2);
    expect(bar.querySelectorAll('[data-kb-class]')).toHaveLength(2);
  });

  test('every Turn is listed, one that named no class too, and no class is guessed for it', async () => {
    show(reveal({ shown: [{ kind: 'turn', act: 'x', at: OCT20 }] }));
    const post = await screen.findByRole('region', { name: /in the season's reveal/u });
    expect(post).toHaveTextContent('A Turn on Oct 20');
    expect(screen.queryByRole('img', { name: /Classes its player made public/u })).toBeNull();
    expect(post).not.toHaveTextContent(/Face|Heel/u);
  });

  test('a Turn that named its old class is listed once, in the words of the bar', async () => {
    show(reveal({ shown: [{ kind: 'turn', act: 'x', at: OCT20, was: 'face', since: '2026-10-01T12:00:00Z' }] }));
    const post = await screen.findByRole('region', { name: /in the season's reveal/u });
    expect(post).not.toHaveTextContent('Announced a Turn');
    const items = within(post).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Face, from Oct 1 until its Turn on Oct 20');
  });

  test('a silent-named Turn is one row: "A Turn on Oct 20"', async () => {
    show(reveal({ shown: [{ kind: 'turn', act: 'x', at: OCT20 }] }));
    const post = await screen.findByRole('region', { name: /in the season's reveal/u });
    const items = within(post).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('A Turn on Oct 20');
    expect(post).not.toHaveTextContent('Announced a Turn');
  });

  test('a reveal and a Turn that says the same class since the same day are one segment, not two', async () => {
    show(reveal({
      shown: [
        { kind: 'reveal', act: 'y', at: '2026-10-01T12:00:00Z', class: 'face', via: 'act' },
        { kind: 'turn', act: 'x', at: OCT20, was: 'face', since: '2026-10-01T12:00:00Z' },
      ],
    }));
    const bar = await screen.findByRole('img', { name: /Classes its player made public/u });
    expect(bar.querySelectorAll('[data-kb-class]')).toHaveLength(1);
    const described = bar.getAttribute('aria-label')!;
    expect(described).toContain('Face');
    expect(described).toContain('Oct 20');
    expect(described.match(/Face/gu)).toHaveLength(1);
  });

  test('a character that made nothing public shows no class at all', async () => {
    show(reveal({ shown: [] }));
    const post = await screen.findByRole('region', { name: /in the season's reveal/u });
    expect(post).toHaveTextContent('Its player made nothing about its class public.');
    expect(post).not.toHaveTextContent(/Face|Heel/u);
    expect(screen.queryByRole('img', { name: /Classes its player made public/u })).toBeNull();
  });

  test('the opening post of the reveal is its words', async () => {
    show(actOf('reveal', { season: 1, from: 'a', to: 'b', body: 'Season 1 is over.', characters: 4 }));
    expect(await screen.findByText('Season 1 is over.')).toBeInTheDocument();
  });
});

describe('the tally', () => {
  test('lists the night\'s debuts and announced Turns by name, linked to their profiles', async () => {
    show(actOf('tally', {
      season: 1, part: 1, of: 1, body: '',
      debuts: [{ character: 'c1', name: 'Spritey', class: 'face' }, { character: 'c2', name: 'Pipewrench' }],
      turns: [{ character: 'c2', name: 'Pipewrench', loudness: 'announced', was: 'face', class: 'heel' }],
    }));
    const tally = await screen.findByRole('region', { name: 'The tally' });
    expect(tally).toHaveTextContent('Spritey debuts as Face');
    expect(tally).toHaveTextContent('Pipewrench debuts');
    expect(tally).toHaveTextContent('Pipewrench has Turned from Face to Heel');
    expect(within(tally).getAllByRole('link', { name: 'Pipewrench' })[0]).toHaveAttribute('href', '/c/c2');
  });

  test('says which part of a long tally this is', async () => {
    show(actOf('tally', { season: 1, part: 2, of: 3, debuts: [{ character: 'c1', name: 'Spritey' }], turns: [] }));
    expect(await screen.findByText('Part 2 of 3')).toBeInTheDocument();
  });
});

describe('on a thread of The System\'s board', () => {
  test('a reveal post and a tally can be reacted to and spun from like any Act', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    fake.seed.character(me, 'Pipewrench', 'heel');
    const sys = fake.seed.thread('the-system', null, 'Reveal', '', { kind: 'reveal', payload: { season: 1, from: 'a', to: 'b', body: 'Over.', characters: 1 } });
    fake.seed.post(sys.thread, null, '', { kind: 'reveal', payload: { season: 1, character: 'c1', name: 'Pipewrench', place: 1, standing: 100, shown: [] } });
    fake.seed.post(sys.thread, null, '', { kind: 'tally', payload: { season: 1, part: 1, of: 1, debuts: [], turns: [{ character: 'c1', name: 'Pipewrench', loudness: 'announced' }] } });
    fake.signInAs(me);
    renderIn(fake, <ThreadScreen thread={sys.thread} />, { path: `/t/${sys.thread}` });
    for (const n of [2, 3]) {
      const article = await screen.findByRole('article', { name: new RegExp(`^Post ${n} by The System`, 'u') });
      expect(within(article).getByRole('button', { name: /React/u })).toBeInTheDocument();
      expect(within(article).getByRole('button', { name: 'Spin thread' })).toBeInTheDocument();
    }
  });
});
