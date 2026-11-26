import { screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useBoardName } from './boards.ts';
import { buildWorld, renderIn } from './test-world.tsx';

function Name({ id }: { readonly id: string }) {
  const name = useBoardName();
  return <li>{name(id) ?? 'unknown'}</li>;
}

describe('useBoardName without a boot list', () => {
  test('many instances mounted together make one read of the boards', async () => {
    const fake = buildWorld();
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    const read = vi.spyOn(fake, 'boards');
    renderIn(fake, <ul>{Array.from({ length: 12 }, (_, i) => <Name key={i} id={general.id} />)}</ul>);
    await waitFor(() => expect(screen.getAllByText('General')).toHaveLength(12));
    expect(read).toHaveBeenCalledTimes(1);
  });
});
