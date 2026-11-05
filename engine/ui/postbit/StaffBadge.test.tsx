import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Character } from '../data/api.ts';
import { renderInWorld } from '../test-world.tsx';
import { StaffBadge } from './StaffBadge.tsx';

const character = (over: Partial<Character> = {}): Character => ({
  id: 'c1', name: 'Hall Monitor', title: 'Hall monitor', signature: '', avatarSquare: null, avatarPortrait: null,
  squareFrame: null, portraitFrame: null, pipStyle: 'default', joined: '2026-10-01', ...over,
});
const show = (c: Character) => renderInWorld(<StaffBadge character={c} />, { settings: { staffGroup: { name: 'Test Cores' } } });

describe('a staff character\'s badge', () => {
  test('a member persona shows the group and no office title', () => {
    show(character({ staff: 'bot-a', office: 'member' }));
    expect(screen.getByText('Test Cores')).toBeInTheDocument();
    expect(screen.queryByText('MODERATOR')).toBeNull();
    expect(screen.queryByText('ADMINISTRATOR')).toBeNull();
  });

  test('a benched persona is in the group too, with no office title', () => {
    show(character({ staff: 'bot-a', office: 'benched' }));
    expect(screen.getByText('Test Cores')).toBeInTheDocument();
    expect(screen.queryByText('MODERATOR')).toBeNull();
  });

  test('a mod shows the group and MODERATOR', () => {
    show(character({ staff: 'bot-a', office: 'mod' }));
    expect(screen.getByText('Test Cores')).toBeInTheDocument();
    expect(screen.getByText('MODERATOR')).toBeInTheDocument();
    expect(screen.queryByText('ADMINISTRATOR')).toBeNull();
  });

  test('the Boss shows the group and ADMINISTRATOR', () => {
    show(character({ staff: 'boss-a', office: 'boss' }));
    expect(screen.getByText('Test Cores')).toBeInTheDocument();
    expect(screen.getByText('ADMINISTRATOR')).toBeInTheDocument();
  });

  test('the group is the setting\'s name, whatever the instance calls it', () => {
    renderInWorld(<StaffBadge character={character({ staff: 'bot-a', office: 'mod' })} />, { settings: { staffGroup: { name: 'Other Group' } } });
    expect(screen.getByText('Other Group')).toBeInTheDocument();
    expect(screen.queryByText('Test Cores')).toBeNull();
  });

  test('the developer shows nothing', () => {
    const { container } = show(character({ staff: 'developer', office: 'developer' }));
    expect(container).toBeEmptyDOMElement();
  });

  test('poison: a player character planted with a staff office or a group label shows nothing', () => {
    const { container } = show(character({ office: 'mod' }));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Test Cores')).toBeNull();
  });
});
