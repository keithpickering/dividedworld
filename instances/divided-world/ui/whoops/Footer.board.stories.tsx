/**
 * The post's footer bar under the lightest and the darkest ink a player can pick (the owner's word of 2026-10-31, the
 * screens-and-cards plan's amendment on the post's footer bar): #41 of the boards fixture, splatted by one more layer on top
 * of the fixture's magenta one, in white or in black. The bar is opaque and never inked, so Quote, Spin thread and History
 * read against the bar's own ground whatever ink lies in the body above it; e2e/footer.spec.ts reads their computed colors
 * at 390 and 1440. No board draws these, they are for the test and the owner's eye. Open them at the width named.
 *
 * The extra layer is a card play the fake is handed through its seed (the caster is #42's author, who is not #41's), heard
 * live by the thread as a play that arrives is.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { ThreadScreen } from '../../../../engine/ui/thread/Thread.tsx';

/** What the extreme inks are: the lightest and the darkest a color field can hold. */
const INKS = { lightest: '#ffffff', darkest: '#000000' } as const;

function Inked({ ink }: { readonly ink: keyof typeof INKS }) {
  const { api } = useKayfa();
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  useEffect(() => {
    if (thread === null) return;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 41, 41), api.acts(thread, 42, 42)]);
      if (!target || !caster?.character) return;
      (api as Fake).seed.card(caster.character, target.id, 'whoops', { layer: 2, live: true, config: { color: INKS[ink], seed: 7 }, message: `${ink} ink` });
    })();
  }, [api, thread, ink]);
  return <Frame>{thread ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Inked> = {
  title: 'Boards/01 Footer ink',
  component: Inked,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Inked>;

/** At the Main board's width. */
export const LightestInk: Story = { args: { ink: 'lightest' } };
export const DarkestInk: Story = { args: { ink: 'darkest' } };
/** On the Phone board's moment, opened at 390 by 844. */
export const LightestInkPhone: Story = { args: { ink: 'lightest' }, parameters: { moment: '02-phone' } };
export const DarkestInkPhone: Story = { args: { ink: 'darkest' }, parameters: { moment: '02-phone' } };
