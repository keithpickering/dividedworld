/**
 * The end-to-end build's story route (web/src/data/fixtures/stories.tsx): the board match's stories,
 * found by the id Storybook gives them, rendered with the preview's decorators as Storybook renders
 * them; an id it does not have fails by name, listing the ones it has, so a manifest that names a
 * story wrong says so on the error screen. The address is read apart from the stories
 * (address.ts), so the app's own pages never load the preview to ask.
 */
import { render, screen } from '@testing-library/react';
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
