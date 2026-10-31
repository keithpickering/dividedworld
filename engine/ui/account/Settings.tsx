/**
 * Settings, on the glass, as the Settings board draws it (docs/research/2026-10-29-two-worlds/11-settings.html;
 * the glass plan, sections 7 and 8, and its choices 2, 3 and 4): the heading, a navigation of its
 * sections, Account and Accessibility (the board's Notifications, Privacy and Export my data wait
 * for a design), and the section beside it.
 *
 * Accessibility: motion (its sentence naming the instance's own card, `InstanceUi.copy`), smoke, contrast, text size, the board's colors (the device's, black on
 * white, white on black, then the instance's own themes) and the post style, each a row of skewed
 * choices with its sentence. Each is saved to the account the moment it is chosen and applied to the
 * page at once (applyAppearance): the theme restyles the board only, the smoke, contrast and text
 * size the glass and the board together. The thread reads the post style when it opens, so a change
 * shows on the next thread view with no reload.
 *
 * Account: the address the session signed in with, plainly and not as a field (it is changed nowhere
 * here), the player's invites (Invites.tsx), and Sign out at its foot. `/invites`, the page invites
 * had before, opens this section (web/src/App.tsx).
 *
 * The section is the address's `?section=`, so the menu bar's Settings stays current on both and the
 * page does not move its focus from the link the player chose.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER, type Answer, type Preferences, type PreferencesPatch } from '../data/api.ts';
import { applyAppearance } from '../appearance.ts';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { Invites } from './Invites.tsx';
import { useSession } from './session.ts';
import './account.css';

interface Option<V extends string | number> { readonly value: V; readonly label: string }

const MOTION: readonly Option<Preferences['motion']>[] = [
  { value: 'system', label: 'Follow my device' },
  { value: 'reduce', label: 'Reduced' },
  { value: 'full', label: 'Full' },
];
const SMOKE: readonly Option<Preferences['smoke']>[] = [
  { value: 'full', label: 'Full' },
  { value: 'low', label: 'Low' },
  { value: 'off', label: 'Off' },
];
const CONTRAST: readonly Option<Preferences['contrast']>[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
];
const TEXT_SIZE: readonly Option<Preferences['textSize']>[] = [100, 125, 150, 200].map((n) => ({ value: n as Preferences['textSize'], label: `${n}%` }));
const POSTBIT: readonly Option<Preferences['postbit']>[] = [
  { value: 'side', label: 'Side by side' },
  { value: 'stacked', label: 'Stacked' },
];

type Section = 'account' | 'accessibility';
const SECTIONS: readonly { readonly key: Section; readonly label: string }[] = [
  { key: 'account', label: 'Account' },
  { key: 'accessibility', label: 'Accessibility' },
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

/** A row of skewed choices, one radio each, as the board draws them; its fieldset's legend is the row's label. */
function Choice<V extends string | number>({ legend, options, value, onChange, sentence }: {
  readonly legend: string; readonly options: readonly Option<V>[]; readonly value: V; readonly onChange: (v: V) => void; readonly sentence: string;
}) {
  const name = useId();
  return (
    <fieldset className="kb-acct-row kb-acct-choice">
      <legend className="kb-acct-row-legend"><h3 className="kb-acct-row-label">{legend}</h3></legend>
      <div className="kb-acct-row-body">
        <div className="kb-acct-seg" role="radiogroup" aria-label={legend}>
          {options.map((o) => (
            <label key={o.value} className="kb-acct-seg-option">
              <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span className="kb-acct-seg-face kb-glass-skew"><b className="kb-glass-upright">{o.label}</b></span>
            </label>
          ))}
        </div>
        <p className="kb-acct-row-sentence">{sentence}</p>
      </div>
    </fieldset>
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
  const { api, ui } = useKayfa();
  const session = useSession(api);
  const navigate = useNavigate();
  const { query } = useLocation();
  const section: Section = query.get('section') === 'account' ? 'account' : 'accessibility';
  const account = session?.account ?? null;
  /*
   * What the screen read, each kept with the account it was read for and drawn only while that
   * account is the one signed in: when the session changes in another tab, the next account's reads
   * are still out for a commit or more, and the last account's address and choices never stand in.
   */
  const [read, setRead] = useState<{ readonly account: string; readonly prefs: Preferences } | null>(null);
  const [addressRead, setAddressRead] = useState<{ readonly account: string; readonly address: string | null } | null>(null);
  const [refusalFor, setRefusal] = useState<{ readonly account: string | null; readonly text: string } | null>(null);
  const [savedFor, setSaved] = useState<string | null>(null);
  const prefs = read?.account === account ? read.prefs : null;
  const address = addressRead?.account === account ? addressRead : null;
  const refusal = refusalFor && refusalFor.account === account ? refusalFor.text : null;
  const saved = account !== null && savedFor === account;
  /* The choices as the page holds them now (before the server has answered), what the account last confirmed, and the saves in line. */
  const current = useRef<Preferences | null>(null);
  const confirmed = useRef<Preferences | null>(null);
  const line = useRef<Promise<void>>(Promise.resolve());
  /* The account the screen is for now, and null once it is gone: a save answered after either changed is that account's no longer. */
  const showing = useRef<string | null>(null);
  useEffect(() => {
    showing.current = account;
    return () => { showing.current = null; };
  }, [account]);

  useEffect(() => {
    if (!account) return;
    let live = true;
    void api.preferences().then((p) => { if (live) { current.current = p; confirmed.current = p; setRead({ account, prefs: p }); } }, () => { if (live) setRefusal({ account, text: 'Your settings could not be read right now. Reload the page to try again.' }); });
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

  /* An account's theme that this instance does not offer is shown as the device's. */
  const offered = new Set<string>(['system', 'light', 'dark', ...ui.themes.slice(1).map((t) => t.key)]);
  const theme = offered.has(prefs.theme) ? prefs.theme : 'system';
  const themeOptions: readonly Option<string>[] = [
    { value: 'system', label: 'Follow my device' },
    { value: 'light', label: 'Black on white' },
    { value: 'dark', label: 'White on black' },
    ...ui.themes.slice(1).map((t) => ({ value: t.key, label: t.name })),
  ];

  /*
   * A choice shows at once; its save waits for the ones before it (one out at a time, so the
   * account ends with the last choice made). A refusal puts back that choice alone, to what the
   * account last confirmed for it, and only while the screen still shows the refused value: a later
   * choice of the same setting, still to be saved, is left on the screen for its own answer. An
   * answer that comes once the player has signed out, another account has signed in or the screen
   * has gone puts nothing on the page: the app has put the next look on the root by then.
   */
  const change = (patch: PreferencesPatch) => {
    const key = Object.keys(patch)[0] as keyof PreferencesPatch;
    const asked = patch[key];
    const madeFor = account;
    if (madeFor === null) return;
    const show = (next: Preferences) => { current.current = next; setRead({ account: madeFor, prefs: next }); applyAppearance(document, next, ui.themes, ui.glass); };
    show({ ...current.current!, ...patch });
    setRefusal(null);
    setSaved(null);
    line.current = line.current.then(async () => {
      let r: Answer<Preferences>;
      try { r = await api.setPreferences(patch); } catch { r = { ok: false, error: LOST_ANSWER }; }
      if (showing.current !== madeFor) return;
      if (r.ok) { confirmed.current = { ...confirmed.current!, [key]: r.value[key] }; setSaved(madeFor); return; }
      if (current.current![key] === asked) show({ ...current.current!, [key]: confirmed.current![key] });
      setRefusal({ account: madeFor, text: r.error });
    }).catch(() => {
      /* Nothing in the line may end it: a choice after a throw is still sent, and it is said and put back as a lost answer is. */
      if (showing.current !== madeFor) return;
      if (current.current && confirmed.current && current.current[key] === asked) show({ ...current.current, [key]: confirmed.current[key] });
      setRefusal({ account: madeFor, text: LOST_ANSWER });
    });
  };

  /*
   * "Show card tips again" empties the set of cards met. It waits its turn behind the choices before it, and the screen shows the
   * empty set once the account has answered (the button is disabled by it, so a second press cannot pile on); a refusal is said.
   */
  const forgetTips = () => {
    const madeFor = account;
    if (madeFor === null) return;
    setRefusal(null);
    setSaved(null);
    line.current = line.current.then(async () => {
      let r: Answer<Preferences>;
      try { r = await api.forgetCardsMet(); } catch { r = { ok: false, error: LOST_ANSWER }; }
      if (showing.current !== madeFor) return;
      if (r.ok) {
        current.current = { ...current.current!, cardsMet: r.value.cardsMet };
        confirmed.current = { ...confirmed.current!, cardsMet: r.value.cardsMet };
        setRead({ account: madeFor, prefs: current.current });
        setSaved(madeFor);
        return;
      }
      setRefusal({ account: madeFor, text: r.error });
    }).catch(() => { if (showing.current === madeFor) setRefusal({ account: madeFor, text: LOST_ANSWER }); });
  };

  const signOut = async () => {
    try {
      await api.signOut();
      navigate('/');
    } catch {
      setRefusal({ account, text: 'Signing out could not be done right now; try again.' });
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

  return (
    <Frame section={section}>
      <section className="kb-settings-section kb-calm" aria-labelledby="kb-settings-accessibility">
        <h2 id="kb-settings-accessibility" className="kb-acct-section-title kb-glass-display">Accessibility</h2>
        <p className="kb-acct-lead">These change how the board and the glass look, read and move. They never change how hard a card is to get through.</p>
        <Choice legend="Motion" options={MOTION} value={prefs.motion} onChange={(v) => change({ motion: v })}
          sentence={`Reduced stops the drifting smoke, the pulses and the orb shine. A card's effect stays: ${ui.copy.reducedMotionCard}`} />
        <Choice legend="Smoke" options={SMOKE} value={prefs.smoke} onChange={(v) => change({ smoke: v })}
          sentence="How much cloud sits behind the glass. Off leaves plain black. Text is readable at every setting." />
        <Choice legend="Contrast" options={CONTRAST} value={prefs.contrast} onChange={(v) => change({ contrast: v })}
          sentence="High puts solid black behind every line of text on the glass and lifts it all to at least 7:1. The smoke stays at the edges of the screen." />
        <Choice legend="Text size" options={TEXT_SIZE} value={prefs.textSize} onChange={(v) => change({ textSize: v })}
          sentence="Applies to the board and the glass together. Past 150% the glass folds into one column, and nothing is cut off." />
        <Choice legend="The board" options={themeOptions} value={theme} onChange={(v) => change({ theme: v })}
          sentence="The 2003 board stays 2003 whichever you choose. Only its colors swap." />
        <Choice legend="Posts" options={POSTBIT} value={prefs.postbit} onChange={(v) => change({ postbit: v })}
          sentence="Side by side puts the character beside each post, as on a classic forum. Stacked puts it above each post, for narrow screens." />
        <Row label="Card tips" sentence="The first time one of a card's marks shows on a page, a small note says what the card does. Each shows once. This brings them all back.">
          <p><button type="button" className="kb-acct-button kb-glass-skew" disabled={prefs.cardsMet.length === 0} onClick={forgetTips}><b className="kb-glass-upright">Show card tips again</b></button></p>
        </Row>
        {said}
        <p className="kb-acct-foot">Changes save as you make them.</p>
      </section>
    </Frame>
  );
}
