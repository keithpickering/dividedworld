import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Character } from '../data/api.ts';
import { renderInWorld } from '../test-world.tsx';
import { StaffBadge } from './StaffBadge.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';

const character = (over: Partial<Character> = {}): Character => ({
  id: 'c1', name: 'Hall Monitor', title: 'Hall monitor', signature: '', avatarSquare: null, avatarPortrait: null,
  squareFrame: null, portraitFrame: null, pipStyle: 'default', pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '2026-10-01', group: 'staff', ...over,
});
const show = (c: Character) => renderInWorld(<StaffBadge character={c} />);

describe('a staff character\'s badge', () => {
  test('a member persona shows nothing: the group is the bar\'s, and it has no office title', () => {
    const { container } = show(character({ staff: 'bot-a', office: 'member' }));
    expect(container).toBeEmptyDOMElement();
  });

  test('a benched persona shows nothing', () => {
    const { container } = show(character({ staff: 'bot-a', office: 'benched' }));
    expect(container).toBeEmptyDOMElement();
  });

  test('a mod shows MODERATOR and no group', () => {
    show(character({ staff: 'bot-a', office: 'mod' }));
    expect(screen.getByText('MODERATOR')).toBeInTheDocument();
    expect(screen.queryByText('Test Cores')).toBeNull();
    expect(screen.queryByText('ADMINISTRATOR')).toBeNull();
  });

  test('the Boss shows ADMINISTRATOR and no group', () => {
    show(character({ staff: 'boss-a', office: 'boss' }));
    expect(screen.getByText('ADMINISTRATOR')).toBeInTheDocument();
    expect(screen.queryByText('Test Cores')).toBeNull();
  });

  test('the developer shows nothing', () => {
    const { container } = show(character({ staff: 'developer', office: 'developer' }));
    expect(container).toBeEmptyDOMElement();
  });

  test('poison: a player character planted with a staff office shows nothing', () => {
    for (const office of ['boss', 'mod', 'member', 'benched'] as const) {
      const { container, unmount } = show(character({ office }));
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText('MODERATOR')).toBeNull();
      expect(screen.queryByText('ADMINISTRATOR')).toBeNull();
      unmount();
    }
  });
});
