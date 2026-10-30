/**
 * The end-to-end build's story route (web/src/data/fixtures/stories.tsx): the board match's stories,
 * found by the id Storybook gives them, rendered with the preview's decorators as Storybook renders
 * them; an id it does not have fails by name, listing the ones it has, so a manifest that names a
 * story wrong says so on the error screen. The address is read apart from the stories
 * (address.ts), so the app's own pages never load the preview to ask.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { storyFromAddress } from './address.ts';
import { boardStory, BOARD_STORY_IDS } from './stories.tsx';

describe('the story route', () => {
  it('has every board story, by the id Storybook gives it', () => {
    expect(BOARD_STORY_IDS).toContain('boards-04-orbs--board');
    expect(BOARD_STORY_IDS.every((id) => id.startsWith('boards-'))).toBe(true);
  });

  it('renders a story with its args and the preview around it, as Storybook does', async () => {
    const Story = boardStory('boards-04-orbs--board');
    render(<Story />);
    expect(await screen.findByRole('img', { name: 'Wallet 4.62 of 6 orbs, 0.40 to be lost at the next settlement (estimate)' })).toBeInTheDocument();
    expect(screen.getByText(/Daily at 08:17 UTC/)).toBeInTheDocument();
  });

  it('renders Rankings\' story for the owner: the season in its order, the player\'s own rows marked, a stranger\'s class only as revealed', async () => {
    const Story = boardStory('boards-13-rankings--season');
    render(<Story />);
    const rows = await screen.findAllByRole('row');
    expect(rows.map((r) => r.querySelector('th[scope="row"]')?.textContent ?? null).filter(Boolean)).toEqual([
      'Spritey Yours', 'Mrs. Hooligan Yours', 'Pipewrench Yours', 'Gloomba', 'Thwompson', 'Ringside 1', 'Ringside 2', 'Ringside 3', 'Ringside 4',
    ]);
    expect(screen.getAllByText('Yours')).toHaveLength(3);
    expect(screen.getAllByText(/^Revealed /)).toHaveLength(2);
    expect(screen.getAllByText(/^Has Turned since /)).toHaveLength(1);
    expect(screen.getAllByText('Not revealed')).toHaveLength(4);
  });

  it('renders the React board\'s story on the fixture\'s moment: the rival\'s view of #42, the picker as the board draws it', async () => {
    expect(BOARD_STORY_IDS).toContain('boards-03-react--board');
    const Story = boardStory('boards-03-react--board');
    render(<Story />);
    const post = await screen.findByRole('article', { name: 'Post 42 by Mrs. Hooligan' });
    /* Opened at the moment's own route, as the app is: the post is found by the address the fixture gives, not by a title. */
    expect(window.location.pathname).toMatch(/^\/t\/[^/]+$/u);
    expect(window.location.hash).toBe('#post-42');
    await userEvent.click(await within(post).findByRole('button', { name: 'React' }));
    const picker = screen.getByRole('dialog', { name: 'React to Mrs. Hooligan\'s post' });
    expect(within(picker).getByRole('status')).toHaveTextContent('2 of 3 left');
    expect(within(picker).getAllByRole('group').map((g) => g.querySelector('.kb-picker-label')?.textContent)).toEqual(['Heat', 'Hype', 'Groan', 'Calm']);
    expect(within(picker).getByRole('button', { name: 'Tea, Calm, your reaction' })).toBeDisabled();
    expect(within(picker).getByText('Arrow keys move, Enter reacts. Outlined: yours.')).toBeInTheDocument();
  });

  it('fails on an id it does not have, naming it and the ones it has', () => {
    expect(() => boardStory('boards-99-nope--board')).toThrow(/boards-99-nope--board[\s\S]*boards-04-orbs--board/);
  });

  it('reads the story from the boards fixture address only', () => {
    expect(storyFromAddress('?fixture=boards&story=boards-04-orbs--board')).toBe('boards-04-orbs--board');
    expect(storyFromAddress('?fixture=boards&moment=01-main')).toBeNull();
    expect(storyFromAddress('?story=boards-04-orbs--board')).toBeNull();
    expect(storyFromAddress('')).toBeNull();
  });
});
