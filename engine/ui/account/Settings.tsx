/**
 * Settings: theme, post style and motion, each saved to the account the moment it is chosen and
 * applied to the page at once, and sign out. The thread reads the post style when it opens, so a
 * change shows on the next thread view with no reload.
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER, type Answer, type Preferences } from '../data/api.ts';
import { applyAppearance } from '../appearance.ts';
import { Link, useNavigate } from '../router.tsx';
import { useSession } from './session.ts';
import './account.css';

interface Option<V extends string> { readonly value: V; readonly label: string; readonly note?: string }

const POSTBIT: readonly Option<Preferences['postbit']>[] = [
  { value: 'side', label: 'Side', note: 'the character beside each post, as on a classic forum' },
  { value: 'stacked', label: 'Stacked', note: 'the character above each post, for narrow screens' },
];
const MOTION: readonly Option<Preferences['motion']>[] = [
  { value: 'system', label: 'Device', note: 'follow the device\'s reduced-motion setting' },
  { value: 'reduce', label: 'Reduce', note: 'less movement; every game obstacle still costs what it did' },
  { value: 'full', label: 'Full', note: 'all the movement, whatever the device says' },
];

function Choice<V extends string>({ legend, name, options, value, onChange }: {
  readonly legend: string; readonly name: string; readonly options: readonly Option<V>[]; readonly value: V; readonly onChange: (v: V) => void;
}) {
  return (
    <fieldset className="kb-setting">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="kb-setting-option">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
          {o.note && <span className="kb-muted kb-small"> ({o.note})</span>}
        </label>
      ))}
    </fieldset>
  );
}

export function SettingsScreen() {
  const { api, ui } = useKayfa();
  const session = useSession(api);
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const account = session?.account ?? null;
  /* The choices as the page holds them now (before the server has answered), and the saves in line. */
  const current = useRef<Preferences | null>(null);
  const line = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!account) return;
    let live = true;
    void api.preferences().then((p) => { if (live) { current.current = p; setPrefs(p); } }, () => { if (live) setRefusal('Your settings could not be read right now. Reload the page to try again.'); });
    return () => { live = false; };
  }, [api, account]);

  if (session === null) return <div className="kb-account" aria-busy="true" />;
  if (!session.signedIn || !account) return <div className="kb-account"><h1 className="kb-heading">Settings</h1><p><Link to="/sign-in">Sign in</Link> to change your settings.</p></div>;
  if (prefs === null) return <div className="kb-account" aria-busy="true"><h1 className="kb-heading">Settings</h1>{refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}</div>;

  /* An account's theme that this instance does not offer is shown as the device's. */
  const offered = new Set<string>(['system', 'light', 'dark', ...ui.themes.slice(1).map((t) => t.key)]);
  const theme = offered.has(prefs.theme) ? prefs.theme : 'system';
  const themeOptions: readonly Option<string>[] = [
    { value: 'system', label: 'Device', note: 'light or dark as the device is set' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    ...ui.themes.slice(1).map((t) => ({ value: t.key, label: t.name })),
  ];

  /*
   * A choice shows at once; its save waits for the ones before it (one out at a time, so the
   * account ends with the last choice made), and a refusal puts back that choice alone.
   */
  const change = (patch: Partial<Preferences>) => {
    const key = Object.keys(patch)[0] as keyof Preferences;
    const was = current.current![key];
    const show = (next: Preferences) => { current.current = next; setPrefs(next); applyAppearance(document, next, ui.themes); };
    show({ ...current.current!, ...patch });
    setRefusal(null);
    setSaved(false);
    line.current = line.current.then(async () => {
      let r: Answer<Preferences>;
      try { r = await api.setPreferences(patch); } catch { r = { ok: false, error: LOST_ANSWER }; }
      if (r.ok) { setSaved(true); return; }
      show({ ...current.current!, [key]: was });
      setRefusal(r.error);
    });
  };

  const signOut = async () => {
    try {
      await api.signOut();
      navigate('/');
    } catch {
      setRefusal('Signing out could not be done right now; try again.');
    }
  };

  return (
    <div className="kb-account kb-settings">
      <h1 className="kb-heading">Settings</h1>
      <p className="kb-muted">Each choice is saved to your account as you make it, so it follows you to other devices.</p>
      <Choice legend="Theme" name="theme" options={themeOptions} value={theme} onChange={(v) => change({ theme: v })} />
      <Choice legend="Post style" name="postbit" options={POSTBIT} value={prefs.postbit} onChange={(v) => change({ postbit: v })} />
      <Choice legend="Motion" name="motion" options={MOTION} value={prefs.motion} onChange={(v) => change({ motion: v })} />
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
      <p role="status" className="kb-small kb-muted">{saved && !refusal ? 'Saved to your account.' : ''}</p>
      <h2 className="kb-heading">Sign out</h2>
      <p><button type="button" className="kb-button" onClick={() => void signOut()}>Sign out</button></p>
    </div>
  );
}
