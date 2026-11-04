/**
 * New character: a name, a class from the class cards, and how it debuts (drop now or at the
 * settlement, silent, announced, or announced with its class), with the preview of what everyone
 * will see. The preview shows no class unless the player chose the option that names it. A full
 * roster says so, and that an admin can retire a character on request.
 *
 * It is a glass page in the Roster board's look (My characters' own), and the menu bar's Back and
 * Cancel are its ways out. Its surface draws no class's large text (engine/ui/glass/apply.ts), so
 * the class cards name each class in the glass's text, the class's color on the card.
 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { DebutLoudness, DebutTiming } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { useNavigate } from '../router.tsx';
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
  const [timing, setTiming] = useState<DebutTiming>('now');
  const [loudness, setLoudness] = useState<DebutLoudness>('announced');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (signedIn === null || (signedIn && !loaded)) return <div className="kb-new-character" aria-busy="true" />;
  if (!signedIn) return <div className="kb-new-character"><SignInPrompt /></div>;

  const active = characters.filter((c) => c.retiredAt === null).length;
  if (active >= settings.charactersPerPlayer) {
    return (
      <div className="kb-new-character">
        <PageHead title="New character" />
        <p className="kb-notice kb-calm">
          You play {active} of {settings.charactersPerPlayer} characters, the most there are. There is no way to free a slot yet; an admin can retire a character on request, and keeps every Act it made.
        </p>
        <div className="kb-calm" data-kb-calm="flush"><ButtonRow><GlassButton to="/characters">Back to your characters</GlassButton></ButtonRow></div>
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
      /* My characters opens on the new one, carried in history.state, never in the address. */
      navigate('/characters', { state: { character: answer.value.id } });
    } catch {
      setRefusal('The character could not be made. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kb-new-character">
      <PageHead title="New character" lead="This page is out of character and only you can see it. Nobody else can tell who plays a character." />
      <form className="kb-new-form" aria-label="New character" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="kb-new-name kb-calm" data-kb-calm="flush">
          <label className="kb-glass-field">
            <span>Name</span>
            <input className="kb-glass-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" aria-describedby="new-name-hint" />
          </label>
          <p id="new-name-hint" className="kb-roster-line">1 to 40 characters. Letters, marks, digits and single spaces. Names are unique, look-alikes included.</p>
        </div>
        <div className="kb-calm" data-kb-calm="flush"><ClassCards legend="Class" value={cls} onChange={setCls} /></div>
        <p className="kb-roster-line kb-calm" data-kb-calm="flush">Only you will know its class, unless you choose to reveal it.</p>
        <div className="kb-calm" data-kb-calm="flush"><DebutChoice name={name} className={className} timing={timing} loudness={loudness} onTiming={setTiming} onLoudness={setLoudness} /></div>
        {refusal && <p role="alert" className="kb-notice kb-calm" data-kb-tone="refusal">{refusal}</p>}
        {/* In a calm, since "Make the character" waits drawn as text on a dashed edge until a name and a class are chosen. */}
        <div className="kb-calm" data-kb-calm="flush">
          <ButtonRow>
            <GlassButton to="/characters">Cancel</GlassButton>
            <GlassButton type="submit" kind="primary" disabled={!cls || name.trim() === '' || busy}>Make the character</GlassButton>
          </ButtonRow>
        </div>
      </form>
    </div>
  );
}
