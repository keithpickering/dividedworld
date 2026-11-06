/**
 * The feels, drawn for the owner to tune before any screen takes them on (glass polish plan, Task
 * 12): the crossing out and back, a screen change left and right, an overlay from an anchor, a modal,
 * a staggered screen of twenty rows and the roster's swap. The switch at the top is Follow my device,
 * Off, Smooth or Snappy; it sets the root's marks as Settings does (`data-kb-motion`,
 * `data-kb-motion-feel`), so the story shows what the player would get. Each demo has a button to
 * play it again. It is a demo built from the presets and the glass parts; no screen uses them yet.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { playerWorld } from '../story.tsx';
import { ButtonRow, GlassButton } from './Button.tsx';
import { backdrop, crossing, modal, overlay, screen, stagger, staggerItem, swap, useFeel } from './motion.ts';
import { Page } from './Page.tsx';
import { PageHead } from './PageHead.tsx';

type Setting = 'system' | 'reduce' | 'smooth' | 'snappy';
const SETTINGS: ReadonlyArray<readonly [Setting, string]> = [['system', 'Follow my device'], ['reduce', 'Off'], ['smooth', 'Smooth'], ['snappy', 'Snappy']];

/** Marks the root the way applyAppearance does for a motion preference. */
function setRoot(s: Setting): void {
  const root = document.documentElement;
  if (s === 'system') root.removeAttribute('data-kb-motion');
  else root.setAttribute('data-kb-motion', s === 'reduce' ? 'reduce' : 'full');
  if (s === 'smooth' || s === 'snappy') root.setAttribute('data-kb-motion-feel', s);
  else root.removeAttribute('data-kb-motion-feel');
}

const STAGE: React.CSSProperties = { position: 'relative', height: 260, overflow: 'hidden', border: '1px solid var(--kb-glass-pale)', marginBottom: 12 };
const CARD: React.CSSProperties = { background: 'var(--kb-glass-ground)', border: '1px solid var(--kb-glass-pale)', padding: 16 };
const TAB = { x: 16, y: 12, width: 120, height: 36 } as const;
const STAGE_SIZE = { width: 720, height: 260 } as const;
const TABS = ['Log', 'Characters', 'Settings'] as const;
const NAMES = ['Gabe', 'Mandy', 'Piranha'] as const;

function Demo({ title, children, replay }: { title: string; children: React.ReactNode; replay: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ font: 'var(--kb-glass-size-body) var(--kb-glass-font-body)' }}>{title}</h2>
      <div style={STAGE}>{children}</div>
      <ButtonRow>{replay}</ButtonRow>
    </section>
  );
}

function Crossing({ feel }: { feel: ReturnType<typeof useFeel> }) {
  const [open, setOpen] = useState(true);
  return (
    <Demo title="The crossing" replay={<GlassButton size="s" onClick={() => setOpen(!open)}>{open ? 'Back to the board' : 'Open the menu'}</GlassButton>}>
      <div style={{ position: 'absolute', left: TAB.x, top: TAB.y, width: TAB.width, height: TAB.height, border: '1px solid var(--kb-glass-pale)', display: 'grid', placeItems: 'center' }}>HUD tab</div>
      <AnimatePresence>
        {open && <motion.div key="window" {...crossing(feel, { from: TAB, within: STAGE_SIZE })} style={{ ...CARD, position: 'absolute', inset: 0 }}>The glass page’s window, opened from the tab.</motion.div>}
      </AnimatePresence>
    </Demo>
  );
}

function Screens({ feel }: { feel: ReturnType<typeof useFeel> }) {
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const go = (to: number) => { setDir(to > at ? 1 : -1); setAt(to); };
  return (
    <Demo
      title="Between screens"
      replay={<><GlassButton size="s" onClick={() => go((at + TABS.length - 1) % TABS.length)}>Tab to the left</GlassButton><GlassButton size="s" onClick={() => go((at + 1) % TABS.length)}>Tab to the right</GlassButton></>}
    >
      <AnimatePresence initial={false} custom={dir}>
        <motion.div key={at} custom={dir} {...screen(feel)} style={{ ...CARD, position: 'absolute', inset: 0 }}>{TABS[at]} screen</motion.div>
      </AnimatePresence>
    </Demo>
  );
}

function Overlay({ feel }: { feel: ReturnType<typeof useFeel> }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <Demo
      title="An overlay from an anchor"
      replay={<><GlassButton size="s" onClick={() => setAnchor(anchor ? null : { x: 0, y: 0 })}>{anchor ? 'Close it' : 'Open from the corner'}</GlassButton></>}
    >
      <AnimatePresence>
        {anchor && <motion.div key="o" {...overlay(feel, anchor)} style={{ ...CARD, position: 'absolute', left: 16, top: 16, width: 280 }}>An overlay, grown from the button’s corner.</motion.div>}
      </AnimatePresence>
    </Demo>
  );
}

function Modal({ feel }: { feel: ReturnType<typeof useFeel> }) {
  const [open, setOpen] = useState(false);
  return (
    <Demo title="A modal" replay={<GlassButton size="s" onClick={() => setOpen(!open)}>{open ? 'Close the modal' : 'Open the modal'}</GlassButton>}>
      <AnimatePresence>
        {open && <motion.div key="dim" {...backdrop(feel)} style={{ position: 'absolute', inset: 0, background: 'var(--kb-overlay)' }} />}
        {open && <motion.div key="m" {...modal(feel)} style={{ ...CARD, position: 'absolute', left: '25%', top: 40, width: '50%' }}>A modal, with the board dimmed in step.</motion.div>}
      </AnimatePresence>
    </Demo>
  );
}

function Rows({ feel }: { feel: ReturnType<typeof useFeel> }) {
  const [run, setRun] = useState(0);
  const delays = stagger(feel, 20);
  return (
    <Demo title="A staggered screen of twenty rows" replay={<GlassButton size="s" onClick={() => setRun(run + 1)}>Play it again</GlassButton>}>
      <div key={run} style={{ columns: 2, padding: 8 }}>
        {Array.from({ length: 20 }, (_, i) => <motion.div key={i} {...staggerItem(feel, delays, i)} style={{ padding: '2px 8px' }}>Row {i + 1}</motion.div>)}
      </div>
    </Demo>
  );
}

function Swap({ feel }: { feel: ReturnType<typeof useFeel> }) {
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const go = (to: number) => { setDir(to > at ? 1 : -1); setAt(to); };
  return (
    <Demo title="The roster’s swap" replay={<>{NAMES.map((n, i) => <GlassButton key={n} size="s" kind={i === at ? 'primary' : 'secondary'} onClick={() => go(i)}>{n}</GlassButton>)}</>}>
      <AnimatePresence initial={false} mode="popLayout" custom={dir}>
        <motion.div key={at} custom={dir} {...swap(feel)} style={{ ...CARD, position: 'absolute', inset: 0 }}>{NAMES[at]}’s panel</motion.div>
      </AnimatePresence>
    </Demo>
  );
}

function Motion() {
  const [setting, setSetting] = useState<Setting>('smooth');
  useEffect(() => {
    setRoot(setting);
    return () => setRoot('system');
  }, [setting]);
  const feel = useFeel();
  return (
    <Page surface="settings">
      <PageHead title="Motion" eyebrow="Glass polish" lead="Choose a feel, then play each demo. Off stops every animation." />
      <ButtonRow>
        {SETTINGS.map(([key, label]) => <GlassButton key={key} size="s" kind={setting === key ? 'primary' : 'secondary'} aria-pressed={setting === key} onClick={() => setSetting(key)}>{label}</GlassButton>)}
      </ButtonRow>
      <p>Now playing: {feel ? feel.name : 'off'}</p>
      <Crossing feel={feel} />
      <Screens feel={feel} />
      <Overlay feel={feel} />
      <Modal feel={feel} />
      <Rows feel={feel} />
      <Swap feel={feel} />
    </Page>
  );
}

const meta: Meta<typeof Motion> = {
  title: 'Boards/Motion feels',
  component: Motion,
  parameters: { world: playerWorld, path: '/settings', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Motion>;

/** Smooth is the first feel shown; switch to Snappy or Off at the top. */
export const Feels: Story = {};
