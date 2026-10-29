import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Act } from '../data/api.ts';
import { RevealPost, TallyPost } from './Reveal.tsx';

const meta: Meta = { title: 'Reveal/System posts' };
export default meta;

const act = (kind: 'tally' | 'reveal', payload: Record<string, unknown>): Act => ({
  id: 'a', character: null, kind, thread: 't', targetActId: null, seq: 1, createdAt: '2026-10-29T12:00:00Z', payload, currentPayload: payload, editedAt: null, shownEditedAt: null,
});

export const Tally: StoryObj = {
  render: () => <TallyPost act={act('tally', { season: 1, part: 1, of: 1, debuts: [{ character: 'c1', name: 'Spritey' }], turns: [{ character: 'c2', name: 'Pipewrench', loudness: 'announced' }] })} />,
  parameters: { world: () => {}, path: '/' },
};
export const RevealWithClasses: StoryObj = {
  render: () => (
    <RevealPost act={act('reveal', {
      season: 1, character: 'c2', name: 'Pipewrench', place: 3, standing: 4170,
      shown: [{ kind: 'turn', act: 'x', at: '2026-10-20T12:00:00Z', was: 'face', since: '2026-10-01T12:00:00Z' }, { kind: 'reveal', act: 'y', at: '2026-10-21T12:00:00Z', class: 'heel', via: 'act' }],
    })} />
  ),
  parameters: { world: () => {}, path: '/' },
};
export const RevealNothingPublic: StoryObj = {
  render: () => <RevealPost act={act('reveal', { season: 1, character: 'c2', name: 'Pipewrench', place: 3, standing: 4170, shown: [] })} />,
  parameters: { world: () => {}, path: '/' },
};
