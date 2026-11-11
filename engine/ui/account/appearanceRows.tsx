/**
 * The rows of Settings › Accessibility that the welcome page's Before you start draws as well (motion, text size and Brighter effects; its theme row is
 * ThemePicker.tsx's tiles), so both draw one control and one sentence each, and a choice made on either is the same choice. Each row is a
 * fieldset of skewed radios whose legend is the row's label; what to do with a choice is the screen's (preferences.ts saves it).
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Preferences } from '../data/api.ts';
import { useSound } from '../audio/sound.ts';
import type { SoundBus } from '../audio/types.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { allowTilt, subscribeTilt, tiltAskFailed, tiltState, tiltSupported, watchTilt, type TiltState } from '../shine/tilt.ts';
import './account.css';

export interface Option<V extends string | number> {
  readonly value: V;
  readonly label: string;
  /** Greyed and not chosen (a mode a one-mode theme does not hold); the checked one of a held row stays at full strength. */
  readonly disabled?: boolean;
}

export const MOTION: readonly Option<Preferences['motion']>[] = [
  { value: 'system', label: 'Follow my device' },
  { value: 'reduce', label: 'Off' },
  { value: 'full', label: 'Smooth' },
  { value: 'snappy', label: 'Snappy' },
];
export const TEXT_SIZE: readonly Option<Preferences['textSize']>[] = [100, 125, 150, 200].map((n) => ({ value: n as Preferences['textSize'], label: `${n}%` }));
export const SOUND: readonly Option<Preferences['gameSound']>[] = [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }];
export const EFFECTS: readonly Option<Preferences['effects']>[] = [{ value: 'standard', label: 'Off' }, { value: 'bright', label: 'On' }];

/** A row of skewed choices, one radio each, as the board draws them; its fieldset's legend is the row's label. */
export function Choice<V extends string | number>({ legend, options, value, onChange, sentence, level = 3, stack = false, children }: {
  readonly legend: string; readonly options: readonly Option<V>[]; readonly value: V; readonly onChange: (v: V) => void; readonly sentence: ReactNode;
  /** The row label's heading level: 3 under Settings' sections, 4 where the row sits under an h3 (the welcome page's Before you start). */
  readonly level?: 3 | 4;
  /** The choices stack on the phone, each the row's full width (Mode's, whose names are long). */
  readonly stack?: boolean;
  /** What stands under the choices and their sentence, inside the row (the sound rows' volume). */
  readonly children?: ReactNode;
}) {
  const name = useId();
  const Label = level === 3 ? 'h3' : 'h4';
  /* The fieldset is the radio group and its legend names it, so the group is named once. */
  return (
    <fieldset className="kb-acct-row kb-acct-choice" role="radiogroup">
      <legend className="kb-acct-row-legend"><Label className="kb-acct-row-label">{legend}</Label></legend>
      <div className="kb-acct-row-body">
        <div className={stack ? 'kb-acct-seg kb-acct-seg-stack' : 'kb-acct-seg'}>
          {options.map((o) => (
            <label key={o.value} className="kb-acct-seg-option">
              <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
              <span className="kb-acct-seg-face kb-glass-skew"><b className="kb-glass-upright">{o.label}</b></span>
            </label>
          ))}
        </div>
        <p className="kb-acct-row-sentence">{sentence}</p>
        {children}
      </div>
    </fieldset>
  );
}

type Level = { readonly level?: 3 | 4 };

export function MotionRow({ value, onChange, level }: { readonly value: Preferences['motion']; readonly onChange: (v: Preferences['motion']) => void } & Level) {
  const { ui } = useKayfa();
  return (
    <Choice legend="Motion" options={MOTION} value={value} onChange={onChange} level={level}
      sentence={`Off stops every animation. A card's effect still happens: ${ui.copy.reducedMotionCard} Smooth and Snappy are two speeds of the same animations.`} />
  );
}

export function TextSizeRow({ value, onChange, level }: { readonly value: Preferences['textSize']; readonly onChange: (v: Preferences['textSize']) => void } & Level) {
  return (
    <Choice legend="Text size" options={TEXT_SIZE} value={value} onChange={onChange} level={level}
      sentence="Applies to the board and the glass together. Past 150% the glass folds into one column, and nothing is cut off." />
  );
}

export function EffectsRow({ value, onChange, level }: { readonly value: Preferences['effects']; readonly onChange: (v: Preferences['effects']) => void } & Level) {
  return (
    <Choice legend="Brighter effects" options={EFFECTS} value={value} onChange={onChange} level={level}
      sentence="Let card effects on posts use their full colors, even below the usual contrast standard. Some posts may be harder to read." />
  );
}

const SOUND_ROW: Readonly<Record<SoundBus, { readonly legend: string; readonly volume: string; readonly says: string }>> = {
  game: { legend: 'Game sounds', volume: 'Game volume', says: 'Sounds that cards and other game effects make on the board. Every one is also shown as a caption at the bottom of the screen.' },
  interface: { legend: 'Interface sounds', volume: 'Interface volume', says: 'Sounds the board itself makes, apart from the game.' },
};

/**
 * One of the two sound rows: Off or On, and while on a volume (0 to 100 in steps of 5, its value said beside it). The volume is saved on release
 * (the range's native `change`, which a drag does not fire until it lets go, and a key press or a tap fires at once), never while it moves; then
 * the bus's preview, where the instance names one, plays at the new volume. React's `onChange` is the `input` event, so the release is
 * listened for on the element itself, and the number beside it follows the drag.
 */
export function SoundRow({ bus, value, volume, onChange, onVolume, level }: {
  readonly bus: SoundBus; readonly value: Preferences['gameSound']; readonly volume: number;
  readonly onChange: (v: Preferences['gameSound']) => void; readonly onVolume: (v: number) => void;
} & Level) {
  const { ui } = useKayfa();
  const { play } = useSound();
  const id = useId();
  const words = SOUND_ROW[bus];
  const none = bus === 'interface' && !(ui.sounds?.slots ?? []).some((s) => s.bus === 'interface');
  const preview = ui.sounds?.preview?.[bus];
  /* The number follows the drag; the account's volume is what a release saves. */
  const [shown, setShown] = useState(volume);
  useEffect(() => { setShown(volume); }, [volume]);
  const range = useRef<HTMLInputElement>(null);
  const released = useRef<(v: number) => void>(() => {});
  released.current = (v) => {
    onVolume(v);
    if (preview !== undefined) void play(preview);
  };
  const open = value === 'on';
  useEffect(() => {
    const el = range.current;
    if (!el) return undefined;
    const release = () => { released.current(Number(el.value)); };
    el.addEventListener('change', release);
    return () => el.removeEventListener('change', release);
  }, [open]);
  return (
    <Choice legend={words.legend} options={SOUND} value={value} onChange={onChange} level={level}
      sentence={none ? `${words.says} This forum has none yet.` : words.says}>
      {open && (
        <div className="kb-acct-volume">
          <label htmlFor={`${id}-volume`} className="kb-acct-volume-label">{words.volume}</label>
          <input ref={range} id={`${id}-volume`} className="kb-acct-volume-range" type="range" min={0} max={100} step={5} value={shown}
            onChange={(e) => setShown(Number(e.target.value))} aria-valuetext={`${shown}%`} />
          <span className="kb-acct-volume-value" aria-hidden="true">{shown}%</span>
        </div>
      )}
    </Choice>
  );
}

/** What the Tilt row says in each state: the glass's own plain voice, out of character and true. */
const TILT_SAYS: Readonly<Record<TiltState, string>> = {
  on: 'On. Tilting your phone moves the light across shiny cards.',
  off: 'Off. Shiny cards follow your scrolling and your pointer.',
  'needs-allow': 'On for your account, but this phone has not allowed it yet. Your browser asks first.',
  denied: 'Your browser said no, so shiny cards follow your scrolling instead. To change that, allow motion and orientation access for this site in your browser\'s settings, then turn this on again.',
  unsupported: 'This device doesn\'t report tilt, so shiny cards follow your scrolling and your pointer instead.',
  held: 'Off while motion is reduced. Shiny cards hold their light still.',
};

/* DRAFT for owner review, like the sentences above: shown on a phone that still needs the grant after a tap whose request to the browser threw. */
const TILT_NO_ANSWER = 'Your browser didn\'t answer. Tap Allow on this phone to ask again.';

/** Whether this device can use tilt at all: a coarse pointer, or an orientation API. The account's choice saves from any device either way. */
export const tiltRowShown = (): boolean => tiltSupported() || (window.matchMedia?.('(pointer: coarse)').matches ?? false);

/**
 * Whether shiny cards follow the phone's tilt: a switch for the account, and where this phone has not yet allowed it, the button that asks
 * the browser. The browser is asked only from a tap on this row (the switch turned on, or the button), never on its own.
 */
export function TiltRow({ value, onChange }: { readonly value: Preferences['tilt']; readonly onChange: (v: Preferences['tilt']) => void }) {
  const id = useId();
  const switchRef = useRef<HTMLInputElement>(null);
  const state = useSyncExternalStore(subscribeTilt, () => tiltState(value), () => tiltState('off'));
  const noAnswer = useSyncExternalStore(subscribeTilt, tiltAskFailed, () => false);
  /* The device is listened to only while the choice is on and this row is drawn. */
  useEffect(() => (value === 'on' ? watchTilt() : undefined), [value]);
  if (!tiltRowShown()) return null;
  /* The ask is made synchronously inside the tap (iOS refuses it elsewhere); only the focus waits for the answer. When the Allow button
     went away with the answer, focus fell to the page, so it goes to the switch the button belonged to. */
  const allow = () => {
    void allowTilt().then(() => {
      const a = document.activeElement;
      if (!a || a === document.body) switchRef.current?.focus();
    });
  };
  const turn = (on: boolean) => {
    onChange(on ? 'on' : 'off');
    /* Turning it on after a refusal is the tap that asks again. */
    const asked = tiltState('on');
    if (on && (asked === 'denied' || asked === 'needs-allow')) allow();
  };
  return (
    <div className="kb-acct-row">
      <h3 id={`${id}-name`} className="kb-acct-row-label">Tilt shiny cards with your phone</h3>
      <div className="kb-acct-row-body">
        <label className="kb-acct-seg-option">
          <input ref={switchRef} type="checkbox" role="switch" checked={value === 'on'} onChange={(e) => turn(e.target.checked)} aria-labelledby={`${id}-name`} aria-describedby={`${id}-says`} />
          <span className="kb-acct-seg-face kb-glass-skew" aria-hidden="true"><b className="kb-glass-upright">{value === 'on' ? 'On' : 'Off'}</b></span>
        </label>
        <p id={`${id}-says`} className="kb-acct-row-sentence" role="status">{TILT_SAYS[state]}{state === 'needs-allow' && noAnswer ? ` ${TILT_NO_ANSWER}` : ''}</p>
        {state === 'needs-allow' && <ButtonRow><GlassButton onClick={allow}>Allow on this phone</GlassButton></ButtonRow>}
      </div>
    </div>
  );
}
