/*
 * Backfill boards 30 (`Empty`: My log before anything has settled, Mrs. Hooligan's tab, the next settlement 7 h 42 min off) and 31 (`Open`, with
 * its phone twin, board 32's third screen; `EmptyPhone` is its second). The Empty story is the log the 12-log moment reads, with every line taken
 * away and the next settlement set, so the page is the one a player sees before their first settlement.
 */
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
 * `Log`, read as the route's loader reads it, in the glass's page shell.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { Page } from '../glass/Page.tsx';
import { loadLog, type LogDoc } from '../glass-docs.ts';
import { usePlayer } from '../player.tsx';
import { isSignedOutDoc } from '../screen-docs.ts';
import { Log } from './Log.tsx';
import type { LogData } from './lines.ts';
import { useLog } from './useLog.ts';

/** The boards' count down to the settlement: 7 h 42 min, from when the story is drawn. */
const SETTLEMENT_IN = (7 * 60 + 42) * 60_000;

/** The log's document, read as the route's loader reads it (a story has no router to do it). */
function useDoc(): LogDoc | null {
  const { api } = useKayfa();
  const [doc, setDoc] = useState<LogDoc | null>(null);
  useEffect(() => {
    void loadLog({ api, signedIn: async () => (await api.session()).signedIn }, () => Promise.resolve()).then((d) => setDoc(isSignedOutDoc(d) ? null : d));
  }, [api]);
  return doc;
}

/** The log at the board's moment, the newest settlement's breakdown open until it is closed. */
function LogOpen() {
  const doc = useDoc();
  return doc === null ? <div className="kb-log" aria-busy="true" /> : <LogOpenView doc={doc} />;
}

function LogOpenView({ doc }: { readonly doc: LogDoc }) {
  const { api } = useKayfa();
  const { hudCharacter, characters } = usePlayer();
  const { data } = useLog(api, doc, characters, null);
  const [open, setOpen] = useState<ReadonlySet<number> | null>(null);
  const [tab, setTab] = useState<string | null | undefined>(undefined);
  const shown = open ?? new Set(data.log.settlements.slice(0, 1).map((s) => s.id));
  const toggle = (id: number, to?: boolean) => {
    const next = new Set(shown);
    if (to ?? !shown.has(id)) next.add(id); else next.delete(id);
    setOpen(next);
  };
  return <Log data={data} tab={tab !== undefined ? tab : (hudCharacter?.id ?? null)} onTab={setTab} open={shown} onToggle={toggle} />;
}

/** The log a player sees before their first settlement: the moment's characters, no line of any, the next settlement 7 h 42 min off, on Mrs. Hooligan's tab. */
function LogEmpty() {
  const doc = useDoc();
  return doc === null ? <div className="kb-log" aria-busy="true" /> : <LogEmptyView doc={doc} />;
}

function LogEmptyView({ doc }: { readonly doc: LogDoc }) {
  const { api } = useKayfa();
  const { characters } = usePlayer();
  const { data } = useLog(api, doc, characters, null);
  const [tab, setTab] = useState<string | null | undefined>(undefined);
  const bare: LogData = {
    ...data,
    log: { settlements: [], wallet: [], cards: [], packs: [], playsOnMine: [], writes: [], saves: [], setEnds: [], caught: [], ended: [], infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], cosmetics: [], before: null },
    estimate: null, turns: [], nextSettlement: new Date(Date.now() + SETTLEMENT_IN).toISOString(),
  };
  const hooligan = bare.mine.find((c) => c.name === 'Mrs. Hooligan')?.id ?? null;
  return <Log data={bare} tab={tab !== undefined ? tab : hooligan} onTab={setTab} open={new Set()} onToggle={() => {}} />;
}

function LogEmptyStory() {
  return <Page surface="log"><LogEmpty /></Page>;
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

/** My log before anything has settled, on Mrs. Hooligan's tab (board 30). */
export const Empty: StoryObj<typeof LogEmptyStory> = { name: '12 Log, empty', render: () => <LogEmptyStory /> };
/** The same on the Phone board's layout, at 390 by 844 (board 32's second screen). */
export const EmptyPhone: StoryObj<typeof LogEmptyStory> = {
  name: '12 Log, empty, phone 390 × 844', render: () => <LogEmptyStory />,
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
