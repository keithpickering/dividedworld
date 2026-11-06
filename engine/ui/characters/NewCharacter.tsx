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
import { FieldCount } from '../glass/FieldCount.tsx';
import { FormFoot } from '../glass/FormFoot.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { useNavigate } from '../router.tsx';
import { ClassCards } from './ClassCards.tsx';
import { DebutChoice } from './DebutChoice.tsx';
import { newCharacterFooter } from './footers.ts';
import './characters.css';
import { CalmRegion } from '../glass/Calm.tsx';

/** The most characters of a name, as the server holds it. */
const NAME_MAX = 40;

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
        <PageHead size="roster" title="New character" />
        <CalmRegion as="p" className="kb-notice">
          You play {active} of {settings.charactersPerPlayer} characters, the most there are. There is no way to free a slot yet; an admin can retire a character on request, and keeps every Act it made.
        </CalmRegion>
        <CalmRegion><ButtonRow><GlassButton to="/characters">Back to your characters</GlassButton></ButtonRow></CalmRegion>
      </div>
    );
  }

  const className = instance.classes.find((c) => c.key === cls)?.name ?? '';

  const submit = async () => {
    if (!cls || name.trim() === '' || [...name].length > NAME_MAX || busy) return;
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
      <PageHead size="roster" title="New character" lead="This page is out of character and only you can see it. Nobody else can tell who plays a character." leadUnder />
      <CalmRegion as="form" className="kb-new-form" aria-label="New character" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="kb-new-name">
          <label className="kb-glass-field">
            <span>Name</span>
            <input className="kb-glass-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" aria-describedby="new-name-hint" />
          </label>
          <FieldCount id="new-name-hint" hint="Letters, marks, digits and single spaces. Names are unique, look-alikes included." text={name} max={NAME_MAX} />
        </div>
        <div className="kb-new-classes">
          <ClassCards legend="Class" value={cls} onChange={setCls} />
          <p className="kb-roster-line">Only you will know its class, unless you choose to reveal it.</p>
        </div>
        <DebutChoice name={name} className={className} timing={timing} loudness={loudness} onTiming={setTiming} onLoudness={setLoudness} />
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        {/* In a calm, since "Make the character" waits drawn as text on a dashed edge until a name and a class are chosen. */}
        <FormFoot line={newCharacterFooter({ name, className, timing, loudness })}>
          <GlassButton to="/characters">Cancel</GlassButton>
          <GlassButton type="submit" kind="primary" disabled={!cls || name.trim() === '' || [...name].length > NAME_MAX || busy}>Make the character</GlassButton>
        </FormFoot>
      </CalmRegion>
    </div>
  );
}
