/**
 * New character: a name, a class from the class cards, and how it debuts (drop now or at the
 * settlement, silent, announced, or announced with its class), with the preview of what everyone
 * will see. The preview shows no class unless the player chose the option that names it. A full
 * roster says so, and that an admin can retire a character on request.
 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { DebutLoudness, DebutTiming } from '../data/api.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Link, useNavigate } from '../router.tsx';
import { ClassCards } from './ClassCards.tsx';
import { DebutChoice } from './DebutChoice.tsx';
import './characters.css';

export function NewCharacter() {
  const { api, instance, settings } = useKayfa();
  const { characters, loaded, refresh } = usePlayer();
  const navigate = useNavigate();
  const signedIn = useSignedIn(api);
  const [name, setName] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  const [timing, setTiming] = useState<DebutTiming>('tally');
  const [loudness, setLoudness] = useState<DebutLoudness>('announced');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (signedIn === null || (signedIn && !loaded)) return <div className="kb-new-character" aria-busy="true" />;
  if (!signedIn) return <div className="kb-new-character"><SignInPrompt /></div>;

  const active = characters.filter((c) => c.retiredAt === null).length;
  if (active >= settings.charactersPerPlayer) {
    return (
      <div className="kb-new-character">
        <h1 className="kb-heading">New character</h1>
        <p className="kb-notice">
          You play {active} of {settings.charactersPerPlayer} characters, the most there are. There is no way to free a slot yet; an admin can retire a character on request, and keeps every Act it made.
        </p>
        <p><Link to="/characters">Back to your characters</Link></p>
      </div>
    );
  }

  const className = instance.classes.find((c) => c.key === cls)?.name ?? '';

  const submit = async () => {
    if (!cls || name.trim() === '' || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.createCharacter(name, cls, timing, loudness);
      if (!answer.ok) { setRefusal(answer.error); return; }
      await refresh();
      navigate('/characters');
    } catch {
      setRefusal('The character could not be made. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kb-new-character">
      <p className="kb-crumb"><Link to="/">Index</Link> › <Link to="/characters">Your characters</Link> › New character</p>
      <h1 className="kb-heading">New character</h1>
      <p className="kb-muted kb-small">This page is out of character and only you can see it. Nobody else can tell who plays a character.</p>
      <form aria-label="New character" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="kb-field">
          <span>Name</span>
          <input className="kb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" aria-describedby="new-name-hint" />
        </label>
        <p id="new-name-hint" className="kb-small kb-muted">1 to 40 characters. Letters, marks, digits and single spaces. Names are unique, look-alikes included.</p>
        <ClassCards legend="Class" value={cls} onChange={setCls} />
        <p className="kb-small kb-muted">Only you will know its class, unless you choose to reveal it.</p>
        <DebutChoice name={name} className={className} timing={timing} loudness={loudness} onTiming={setTiming} onLoudness={setLoudness} />
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <div className="kb-dialog-actions">
          <Link to="/characters" className="kb-button">Cancel</Link>
          <button type="submit" className="kb-button" data-kb-primary="" disabled={!cls || name.trim() === '' || busy}>Make the character</button>
        </div>
      </form>
    </div>
  );
}
