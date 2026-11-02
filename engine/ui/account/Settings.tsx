/**
 * Settings, on the glass, as the Settings board draws it (docs/research/2026-10-29-two-worlds/11-settings.html;
 * the glass plan, sections 7 and 8, and its choices 2, 3 and 4): the heading, a navigation of its
 * sections, Account, Accessibility and Notifications (the board's Privacy and Export my data wait
 * for a design), and the section beside it.
 *
 * Accessibility: motion (its sentence naming the instance's own card, `InstanceUi.copy`), smoke, contrast, text size, the board's colors (the device's, black on
 * white, white on black, then the instance's own themes) and the post style, each a row of skewed
 * choices with its sentence. Each is saved to the account the moment it is chosen and applied to the
 * page at once (applyAppearance): the theme restyles the board only, the smoke, contrast and text
 * size the glass and the board together. The thread reads the post style when it opens, so a change
 * shows on the next thread view with no reload. Tips has a switch, Show tips again and Replay the HUD tour, each calling its own tips function; the next board
 * page shows the result.
 *
 * Account: the address the session signed in with, plainly and not as a field (it is changed nowhere
 * here), the player's invites (Invites.tsx), and Sign out at its foot. `/invites`, the page invites
 * had before, opens this section (web/src/App.tsx).
 *
 * Notifications: one switch for each kind of alert, saved the moment it is flipped, for whether that kind also toasts (it counts and waits in Alerts
 * either way). A player who has not chosen sees the instance's defaults, said plainly, and "Reset to defaults" puts a choice back to them.
 *
 * The section is the address's `?section=`, so the menu bar's Settings stays current on both and the
 * page does not move its focus from the link the player chose.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Preferences } from '../data/api.ts';
import { ALERT_KINDS, type AlertKind } from '../../rules/alerts.ts';
import { toastDefaultKinds } from '../alerts/toast-kinds.ts';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { Choice, MotionRow, TextSizeRow, ThemeRow, type Option } from './appearanceRows.tsx';
import { Invites } from './Invites.tsx';
import { usePreferenceSaves, type TipsChange } from './preferences.ts';
import { useSession } from './session.ts';
import './account.css';

const SMOKE: readonly Option<Preferences['smoke']>[] = [
  { value: 'full', label: 'Full' },
  { value: 'low', label: 'Low' },
  { value: 'off', label: 'Off' },
];
const CONTRAST: readonly Option<Preferences['contrast']>[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
];
const POSTBIT: readonly Option<Preferences['postbit']>[] = [
  { value: 'side', label: 'Side by side' },
  { value: 'stacked', label: 'Stacked' },
];

/**
 * Each kind of alert, in plain words: what it is called here and the event it tells of. These are the glass's own voice, out of character and
 * true; the in-character words of an alert are the instance's. Kinds the instance has no use for still have a switch, as the engine has them.
 */
const NOTIFICATIONS: readonly { readonly kind: AlertKind; readonly title: string; readonly sentence: string }[] = [
  { kind: 'quote', title: 'Quotes', sentence: 'A post quotes one of your characters.' },
  { kind: 'cardOnYours', title: 'Cards on yours', sentence: 'A card is played on one of your posts.' },
  { kind: 'trapStruck', title: 'Traps that hit', sentence: 'A trap struck one of your posts.' },
  { kind: 'trapSprang', title: 'Traps you set', sentence: 'A trap you set sprang.' },
  { kind: 'ruling', title: 'Rulings', sentence: 'A ruling lands on one of your characters.' },
  { kind: 'settlement', title: 'Settlements', sentence: 'A settlement is in and moved your characters.' },
  { kind: 'update', title: 'Updates', sentence: 'The developer posts an update.' },
  { kind: 'followed', title: 'Followed threads', sentence: 'A thread you follow has new posts.' },
  { kind: 'hint', title: 'Hints', sentence: 'A hint says one of your posts or cards is drawing a pattern of reactions.' },
  { kind: 'seasonNews', title: 'Season news', sentence: 'The season has news: results, debuts and Turns, a new Boss.' },
];

type Section = 'account' | 'accessibility' | 'notifications';
const SECTIONS: readonly { readonly key: Section; readonly label: string }[] = [
  { key: 'account', label: 'Account' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'notifications', label: 'Notifications' },
];
const sectionHref = (s: Section) => (s === 'accessibility' ? '/settings' : `/settings?section=${s}`);

/** One of the board's rows: its label in the 230px column, and what it holds with its sentence under it. */
function Row({ label, children, sentence }: { readonly label: string; readonly children: ReactNode; readonly sentence?: ReactNode }) {
  return (
    <div className="kb-acct-row">
      <h3 className="kb-acct-row-label">{label}</h3>
      <div className="kb-acct-row-body">
        {children}
        {sentence && <p className="kb-acct-row-sentence">{sentence}</p>}
      </div>
    </div>
  );
}

/** One kind of alert: its name in the label column, and a switch (a checkbox read as one) with its sentence and what it does until a player chooses. */
function ToastSwitch({ title, sentence, byDefault, on, onChange }: {
  readonly title: string; readonly sentence: string; readonly byDefault: boolean; readonly on: boolean; readonly onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="kb-acct-row">
      <h3 id={`${id}-name`} className="kb-acct-row-label">{title}</h3>
      <div className="kb-acct-row-body">
        <label className="kb-acct-seg-option">
          <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} aria-labelledby={`${id}-name`} aria-describedby={`${id}-says`} />
          <span className="kb-acct-seg-face kb-glass-skew" aria-hidden="true"><b className="kb-glass-upright">{on ? 'Toasts' : 'Quiet'}</b></span>
        </label>
        <p id={`${id}-says`} className="kb-acct-row-sentence">{sentence} {byDefault ? 'Toasts by default.' : 'Quiet by default.'}</p>
      </div>
    </div>
  );
}

/**
 * Tips: a switch for whether they show at all, and two buttons. In the glass's own voice, so it says plainly what each does and what it leaves
 * alone. The switch shows a click at once and goes back to what the account has if the change is refused.
 */
function TipsRow({ on, change }: { readonly on: boolean; readonly change: (how: TipsChange) => void }) {
  const id = useId();
  return (
    <div className="kb-acct-row">
      <h3 id={`${id}-name`} className="kb-acct-row-label">Tips</h3>
      <div className="kb-acct-row-body">
        <label className="kb-acct-seg-option">
          <input type="checkbox" role="switch" checked={on} onChange={(e) => change(e.target.checked ? 'resume' : 'skip')} aria-labelledby={`${id}-name`} aria-describedby={`${id}-says`} />
          <span className="kb-acct-seg-face kb-glass-skew" aria-hidden="true"><b className="kb-glass-upright">{on ? 'On' : 'Off'}</b></span>
        </label>
        <p id={`${id}-says`} className="kb-acct-row-sentence">
          Tips are the small notes that explain the board as you meet it: the HUD tour, the reaction grid, the ghost on your orbs and each card's marks. Off hides every tip and card note. On shows the ones you have not read yet.
          Show tips again also brings back the ones you have read, and turns tips on. Replay the HUD tour shows the three steps of the tour again and turns tips on.
        </p>
        <p>
          <button type="button" className="kb-acct-button kb-glass-skew" onClick={() => change('restore')}><b className="kb-glass-upright">Show tips again</b></button>
          {' '}
          <button type="button" className="kb-acct-button kb-glass-skew" onClick={() => change('replay')}><b className="kb-glass-upright">Replay the HUD tour</b></button>
        </p>
      </div>
    </div>
  );
}

/** The Settings board's frame: the heading, the sections' navigation, and the section. */
function Frame({ section, children }: { readonly section: Section | null; readonly children: ReactNode }) {
  return (
    <div className="kb-acct kb-settings">
      <h1 className="kb-acct-title kb-glass-display">Settings</h1>
      <div className="kb-settings-body">
        {section && (
          <nav className="kb-settings-nav kb-calm" aria-label="Settings sections">
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.key}>
                  <Link to={sectionHref(s.key)} className="kb-settings-tab kb-glass-skew" aria-current={s.key === section ? 'page' : undefined}>
                    <b className="kb-glass-upright">{s.label}</b>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {children}
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const { api, settings } = useKayfa();
  const session = useSession(api);
  const navigate = useNavigate();
  const { query } = useLocation();
  const asked = query.get('section');
  const section: Section = asked === 'account' || asked === 'notifications' ? asked : 'accessibility';
  const account = session?.account ?? null;
  /* The preferences, read and saved as the welcome page's rows save them too (preferences.ts). */
  const { prefs, refusal, saved, change, changeTips, refuse } = usePreferenceSaves(account);
  /* The address is read for the account too, and drawn only while that account is the one signed in. */
  const [addressRead, setAddressRead] = useState<{ readonly account: string; readonly address: string | null } | null>(null);
  const address = addressRead?.account === account ? addressRead : null;

  useEffect(() => {
    if (!account) return;
    let live = true;
    void api.signInAddress().then((a) => { if (live) setAddressRead({ account, address: a }); }, () => { if (live) setAddressRead({ account, address: null }); });
    return () => { live = false; };
  }, [api, account]);

  if (session === null) return <div className="kb-acct" aria-busy="true" />;
  if (!session.signedIn || !account) {
    return <Frame section={null}><p className="kb-acct-lead kb-calm"><Link to="/sign-in">Sign in</Link> to change your settings.</p></Frame>;
  }
  if (prefs === null) {
    return <Frame section={section}><div className="kb-settings-section" aria-busy="true">{refusal && <p role="alert" className="kb-acct-refusal kb-calm">{refusal}</p>}</div></Frame>;
  }

  const signOut = async () => {
    try {
      await api.signOut();
      navigate('/');
    } catch {
      refuse('Signing out could not be done right now; try again.');
    }
  };

  const said = (
    <>
      {refusal && <p role="alert" className="kb-acct-refusal kb-calm">{refusal}</p>}
      <p role="status" className="kb-acct-note">{saved && !refusal ? 'Saved to your account.' : ''}</p>
    </>
  );

  if (section === 'account') {
    return (
      <Frame section={section}>
        <section className="kb-settings-section kb-calm" aria-labelledby="kb-settings-account">
          <h2 id="kb-settings-account" className="kb-acct-section-title kb-glass-display">Account</h2>
          <p className="kb-acct-lead">Out of character: what you sign in with, and who you bring in.</p>
          <Row label="Sign-in address" sentence="The address the code and the link come to. It is not shown to anyone else.">
            {address === null
              ? <p className="kb-acct-value" aria-busy="true" />
              : <p className="kb-acct-value">{address.address ?? 'Your address could not be read right now. Reload the page to try again.'}</p>}
          </Row>
          <Row label="Invites"><Invites /></Row>
          {said}
          <Row label="Sign out" sentence="Ends this session on this device. Your characters and settings stay with your account.">
            <p><button type="button" className="kb-acct-button kb-glass-skew" onClick={() => void signOut()}><b className="kb-glass-upright">Sign out</b></button></p>
          </Row>
        </section>
      </Frame>
    );
  }

  if (section === 'notifications') {
    const defaultKinds = toastDefaultKinds(settings.toastDefaults);
    const keptOn = prefs.toasts ?? defaultKinds;
    const flip = (kind: AlertKind, on: boolean) => change({ toasts: ALERT_KINDS.filter((k) => (k === kind ? on : keptOn.includes(k))) });
    return (
      <Frame section={section}>
        <section className="kb-settings-section kb-calm" aria-labelledby="kb-settings-notifications">
          <h2 id="kb-settings-notifications" className="kb-acct-section-title kb-glass-display">Notifications</h2>
          <p className="kb-acct-lead">Every alert still counts and waits in Alerts. These switches choose which kinds also pop up as a toast while you read.</p>
          <div role="group" aria-label="Which alerts toast">
            {NOTIFICATIONS.map((n) => (
              <ToastSwitch key={n.kind} title={n.title} sentence={n.sentence} byDefault={defaultKinds.includes(n.kind)} on={keptOn.includes(n.kind)} onChange={(on) => flip(n.kind, on)} />
            ))}
          </div>
          <Row label="Defaults" sentence={prefs.toasts === null ? 'You have not chosen, so the defaults hold.' : 'You have chosen your own. This puts every switch back to this board\'s defaults.'}>
            <p><button type="button" className="kb-acct-button kb-glass-skew" aria-disabled={prefs.toasts === null} onClick={() => { if (prefs.toasts !== null) change({ toasts: null }); }}><b className="kb-glass-upright">Reset to defaults</b></button></p>
          </Row>
          {said}
          <p className="kb-acct-foot">Changes save as you make them.</p>
        </section>
      </Frame>
    );
  }

  return (
    <Frame section={section}>
      <section className="kb-settings-section kb-calm" aria-labelledby="kb-settings-accessibility">
        <h2 id="kb-settings-accessibility" className="kb-acct-section-title kb-glass-display">Accessibility</h2>
        <p className="kb-acct-lead">These change how the board and the glass look, read and move. They never change how hard a card is to get through.</p>
        <MotionRow value={prefs.motion} onChange={(v) => change({ motion: v })} />
        <Choice legend="Smoke" options={SMOKE} value={prefs.smoke} onChange={(v) => change({ smoke: v })}
          sentence="How much cloud sits behind the glass. Off leaves plain black. Text is readable at every setting." />
        <Choice legend="Contrast" options={CONTRAST} value={prefs.contrast} onChange={(v) => change({ contrast: v })}
          sentence="High puts solid black behind every line of text on the glass and lifts it all to at least 7:1. The smoke stays at the edges of the screen." />
        <TextSizeRow value={prefs.textSize} onChange={(v) => change({ textSize: v })} />
        <ThemeRow value={prefs.theme} onChange={(v) => change({ theme: v })} />
        <Choice legend="Posts" options={POSTBIT} value={prefs.postbit} onChange={(v) => change({ postbit: v })}
          sentence="Side by side puts the character beside each post, as on a classic forum. Stacked puts it above each post, for narrow screens." />
        <TipsRow on={prefs.tips === 'on'} change={changeTips} />
        {said}
        <p className="kb-acct-foot">Changes save as you make them.</p>
      </section>
    </Frame>
  );
}
