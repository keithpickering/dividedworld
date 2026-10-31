/**
 * "12 Log, open": My log with a settlement's breakdown open under its row, drawn first as a story for
 * the owner (the log shares plan's Task 5; the glass plan, section 8), because no board draws it. The
 * Log board (12-log.html) draws the rows closed; this is the same page at the board's moment
 * (`12-log`: Pipewrench's tab at 08:30 on Oct 30), with the Oct 30 settlement's Show posts pressed:
 * each reason with its exact total, its share on each post the estimate valued, with the post's link
 * and the quadrant's label, and the sentence that says what a share is. The settlement before it was
 * made before shares were kept, so its row has no control and says why.
 *
 * Its tests wait on the owner's word on this story (the plan's Task 5); the page is the screen's own
 * `Log`, read as LogScreen reads it, in the glass's page shell.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import { Page } from '../glass/Page.tsx';
import { useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Log } from './Log.tsx';
import { useLog } from './useLog.ts';

/** The log at the board's moment, the newest settlement's breakdown open until it is closed. */
function LogOpen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const { session, hudCharacter } = usePlayer();
  const { state } = useLog(api, signedIn, session.account);
  const [open, setOpen] = useState<ReadonlySet<number> | null>(null);
  const [tab, setTab] = useState<string | null | undefined>(undefined);
  if (state.status !== 'ready') return <div className="kb-log" aria-busy="true" />;
  const shown = open ?? new Set(state.data.log.settlements.slice(0, 1).map((s) => s.id));
  const toggle = (id: number, to?: boolean) => {
    const next = new Set(shown);
    if (to ?? !shown.has(id)) next.add(id); else next.delete(id);
    setOpen(next);
  };
  return <Log data={state.data} tab={tab !== undefined ? tab : (hudCharacter?.id ?? null)} onTab={setTab} open={shown} onToggle={toggle} />;
}

function LogOpenStory() {
  return <Page surface="log"><LogOpen /></Page>;
}

const meta: Meta<typeof LogOpenStory> = {
  title: 'Boards/12 Log',
  component: LogOpenStory,
  parameters: { moment: '12-log', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof LogOpenStory>;

/** The Oct 30 settlement's row open, on the Main board's layout at 1440 wide. */
export const Open: Story = { name: '12 Log, open' };
/** The same on the Phone board's layout, at 390 by 844. */
export const OpenPhone: Story = {
  name: '12 Log, open, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
