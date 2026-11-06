/**
 * The board's line for an announcement (the season-end design, section 4): one Act of the character's own that says everything its
 * player chose to make public, in the engine's words and the instance's class names.
 */
import { screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, test } from 'vitest';
import { useKayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { AnnounceLine } from './lines.tsx';

const lines: readonly { readonly what: 'debut' | 'turn'; readonly was?: string; readonly class?: string; readonly says: string }[] = [
  { what: 'debut', says: 'Spritey debuts.' },
  { what: 'debut', class: 'heel', says: 'Spritey debuts as a Heel.' },
  { what: 'turn', says: 'Spritey has Turned.' },
  { what: 'turn', was: 'heel', says: 'Spritey has Turned, leaving Heel.' },
  { what: 'turn', class: 'face', says: 'Spritey has Turned to Face.' },
  { what: 'turn', was: 'heel', class: 'face', says: 'Spritey has Turned from Heel to Face.' },
];

function Line({ act, name }: { readonly act: string; readonly name: string }) {
  const { api } = useKayfa();
  const [read, setRead] = useState<Act | null>(null);
  useEffect(() => { void api.actsById([act]).then((a) => setRead(a[0] ?? null)); }, [api, act]);
  return read ? <AnnounceLine act={read} name={name} /> : null;
}

describe('the announce line', () => {
  test.each(lines)('says "$says"', async ({ what, was, class: cls, says }) => {
    const fake = buildWorld();
    const owner = fake.seed.account('o');
    const spritey = fake.seed.character(owner, 'Spritey', 'face');
    const act = fake.seed.announce(spritey, what, { was, class: cls });
    renderIn(fake, <Line act={act} name="Spritey" />, { path: '/' });
    await waitFor(() => expect(screen.getByText(says)).toBeInTheDocument());
    expect(screen.getByText(says).tagName).toBe('P');
  });
});
