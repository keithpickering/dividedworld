/**
 * The board's look, as Settings › The board draws it (docs/research/2026-11-06-board-look/19-theme-picker.html, 20 and 21 on the phone) and as the
 * welcome page's Before you start shares it: a theme row and a mode row, the two things the account holds apart (appearance.ts).
 *
 * ThemeRow is one radio group of tiles, a thumbnail and the theme's name and modes each, so arrows move between them, and a choice applies at
 * once (preferences.ts) as a theme alone: the player's own mode is kept, so choosing the house theme again returns them to it. In Settings it
 * also draws the chosen theme's preview, the board's first screen in miniature. Both are drawn from `ThemeOption.preview`, the theme's own
 * tokens read from its file at build time (tools/theme-preview.mjs), set on the miniature itself as `--tp-*` properties: the page wears the
 * player's current theme, so a miniature that read the page's tokens would show that theme and not the one it names. The miniature and the
 * thumbnails are decoration (aria-hidden); the radio group carries the names.
 *
 * ModeRow is Follow my device, Light and Dark. A theme that holds one mode holds the row to it, the others greyed, and says why on the screen
 * and names the house theme, which holds both: the way out of a held mode is on the screen where it shows.
 */
import { useId, useSyncExternalStore, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { Preferences } from '../data/api.ts';
import type { ThemeOption, ThemePreview } from '../types.ts';
import { Choice, type Option } from './appearanceRows.tsx';
import './account.css';

/** What the rows read of the account's choice: an appearance with no mode stored (where a page draws before it has read one) follows the device. */
export type LookValue = Pick<Preferences, 'theme'> & { readonly mode?: Preferences['mode'] };

export const MODE: readonly Option<Preferences['mode']>[] = [
  { value: 'system', label: 'Follow my device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const MODE_WORDS: Readonly<Record<ThemeOption['modes'], string>> = { both: 'Light and dark', light: 'Light only', dark: 'Dark only' };

/** The theme a stored choice names: "default" is the instance's first (the house theme), and a key it does not offer falls back to it. */
export function chosenTheme(themes: readonly ThemeOption[], theme: string): ThemeOption {
  const house = themes[0];
  if (!house) throw new Error('an instance offers at least one theme, its house theme');
  return themes.find((t) => t.key === theme && theme !== 'default') ?? house;
}

function subscribeDevice(onChange: () => void): () => void {
  const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
/** Whether the device is in its dark mode, kept current. */
function useDeviceDark(): boolean {
  return useSyncExternalStore(subscribeDevice, () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false, () => false);
}

/** The mode a theme is drawn in: the one it holds, or for a theme that holds both, the player's, else the device's. */
export function shownMode(theme: ThemeOption, mode: Preferences['mode'] | undefined, deviceDark: boolean): 'light' | 'dark' {
  if (theme.modes !== 'both') return theme.modes;
  return mode === 'light' || mode === 'dark' ? mode : deviceDark ? 'dark' : 'light';
}

/** A theme's tokens in a mode (the other mode's if the theme holds only that one, so a tile is never blank). */
function previewIn(theme: ThemeOption, mode: 'light' | 'dark'): ThemePreview {
  return theme.preview[mode] ?? theme.preview.light ?? theme.preview.dark ?? {};
}

/** The preview's tokens as the miniature's own custom properties. */
const SCOPE: readonly (readonly [string, string])[] = [
  ['--tp-page', '--kb-bg'], ['--tp-fg', '--kb-fg'], ['--tp-link', '--kb-link'], ['--tp-grid', '--kb-grid'], ['--tp-frame', '--kb-frame'],
  ['--tp-banner', '--kb-banner-bg'], ['--tp-logo', '--kb-logo-fg'], ['--tp-nav', '--kb-nav-bg'], ['--tp-navfg', '--kb-nav-fg'],
  ['--tp-head', '--kb-head-bg'], ['--tp-headfg', '--kb-head-fg'], ['--tp-r1', '--kb-row-1'], ['--tp-r2', '--kb-row-2'], ['--tp-r3', '--kb-row-3'],
  ['--tp-button', '--kb-button-bg'], ['--tp-button-edge', '--kb-button-edge'], ['--tp-button-fg', '--kb-button-fg'], ['--tp-button-case', '--kb-button-case'],
];
/* The page is drawn from the theme's page ground when it gives one (a tiled page), else from its plain background. */
const scoped = (p: ThemePreview): CSSProperties => Object.fromEntries([...SCOPE.flatMap(([own, token]) => (p[token] === undefined ? [] : [[own, p[token]]])), ...(p['--kb-page-bg'] === undefined ? [] : [['--tp-page', p['--kb-page-bg']]])]) as CSSProperties;

/** The sample threads the miniature lists: plain words, the board's own title and the new-thread mark on the first two. */
const SAMPLE: readonly { readonly title: string; readonly by: string; readonly replies: string; readonly fresh: boolean }[] = [
  { title: 'Rate my avatar', by: 'Ann', replies: '0', fresh: true },
  { title: 'The long one', by: 'Bo', replies: '169', fresh: true },
  { title: 'Who keeps reacting with a thumbs up?', by: 'Cy', replies: '3', fresh: false },
];

/** The board's first screen in miniature: the banner, the boards bar, a title, Start a thread and the thread list, in one theme's tokens. */
function BoardPreview({ tokens }: { readonly tokens: ThemePreview }) {
  const { ui } = useKayfa();
  return (
    <div className="kb-tp-big" aria-hidden="true" style={scoped(tokens)}>
      <div className="kb-tp-banner"><b>{ui.copy.siteName.toUpperCase()}</b><i /></div>
      <div className="kb-tp-nav"><span>Index</span><span>General</span><span>Announcements</span></div>
      <div className="kb-tp-title">General</div>
      <div className="kb-tp-btn">Start a thread</div>
      <div className="kb-tp-table">
        <div className="kb-tp-h"><span /><span>Thread</span><span>Replies</span><span>Last post</span></div>
        {SAMPLE.map((r, i) => (
          <div key={r.title} className="kb-tp-r" style={{ '--tp-row': `var(--tp-r${i % 2 ? 2 : 1})` } as CSSProperties}>
            <span><i className={r.fresh ? 'kb-tp-f kb-tp-f-new' : 'kb-tp-f'} /></span>
            <span><u>{r.title}</u><small>{r.by}</small></span>
            <span className="kb-tp-c">{r.replies}</span>
            <span><u>{r.by}</u><small>Oct 6, 2026</small></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A tile's thumbnail: the banner, the bar, the head and three rows, drawn in the theme's tokens. */
function Thumb({ tokens }: { readonly tokens: ThemePreview }) {
  return (
    <span className="kb-tp-thumb" aria-hidden="true" style={scoped(tokens)}>
      <i className="kb-tp-tb" /><i className="kb-tp-tn" /><i className="kb-tp-th" />
      {[0, 1, 2].map((n) => <i key={n} className="kb-tp-tr"><s /><s /></i>)}
    </span>
  );
}

/**
 * The theme row: one tile per theme as a radio group, and in Settings (`previewed`) the chosen theme's miniature over them and the sentence
 * under. A choice is a theme alone: `onChange` is given the theme to save, "default" for the house theme.
 */
export function ThemeRow({ value, onChange, previewed = false, level = 3 }: {
  readonly value: LookValue;
  readonly onChange: (theme: string) => void;
  /** Draw the chosen theme's miniature above the tiles, and the sentence under them. */
  readonly previewed?: boolean;
  /** The row label's heading level: 3 under Settings' sections, 4 under the welcome page's h3. */
  readonly level?: 3 | 4;
}) {
  const { ui } = useKayfa();
  const name = useId();
  const deviceDark = useDeviceDark();
  const house = ui.themes[0];
  const chosen = chosenTheme(ui.themes, value.theme);
  const Label = level === 3 ? 'h3' : 'h4';
  return (
    <fieldset className="kb-acct-row kb-acct-choice" role="radiogroup">
      <legend className="kb-acct-row-legend"><Label className="kb-acct-row-label">Theme</Label></legend>
      <div className="kb-acct-row-body">
        {previewed && <BoardPreview tokens={previewIn(chosen, shownMode(chosen, value.mode, deviceDark))} />}
        <div className="kb-tp-tiles">
          {ui.themes.map((t) => (
            <label key={t.key} className="kb-tp-tile">
              <input type="radio" name={name} value={t.key} checked={t === chosen} onChange={() => onChange(t === house ? 'default' : t.key)} />
              <Thumb tokens={previewIn(t, shownMode(t, value.mode, deviceDark))} />
              <b>{t.name}</b>
              <span>{MODE_WORDS[t.modes]}</span>
            </label>
          ))}
        </div>
        {previewed && <p className="kb-acct-row-sentence">Applies to the board at once, on every device you sign in on.</p>}
      </div>
    </fieldset>
  );
}

/**
 * The mode row. For a theme that holds one mode the row is held to it and the others are greyed; the player's own mode stays stored, so
 * choosing a theme that holds both returns them to it.
 */
export function ModeRow({ value, onChange }: { readonly value: LookValue; readonly onChange: (mode: Preferences['mode']) => void }) {
  const { ui } = useKayfa();
  const chosen = chosenTheme(ui.themes, value.theme);
  const house = ui.themes[0]!;
  if (chosen.modes === 'both') {
    return (
      <Choice legend="Mode" options={MODE} value={value.mode ?? 'system'} onChange={onChange} stack
        sentence="The 2003 board stays 2003 whichever you choose. Only its look changes. The game's own pieces (orbs, cards, reactions, marks) keep theirs." />
    );
  }
  const only = chosen.modes;
  return (
    <Choice legend="Mode" stack value={only} onChange={onChange}
      options={MODE.map((o) => ({ ...o, disabled: o.value !== only }))}
      sentence={`${chosen.name} comes in ${only} only, so the board stays ${only} whatever your device says.${chosen === house ? '' : ` Choose ${house.name} for light and dark.`}`} />
  );
}
