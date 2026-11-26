/**
 * New character: a name, a class from the class cards and pronouns. The character is on the board
 * as soon as it is made, and nothing announces it (0436). A full roster says so, and that an admin
 * can retire a character on request.
 *
 * It is a glass page in the Roster board's look (My characters' own), and the menu bar's Back and
 * Cancel are its ways out. Its surface draws no class's large text (engine/ui/glass/apply.ts), so
 * the class cards name each class in the glass's text, the class's color on the card.
 */
import { useId, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { useClaim } from '../glass/claims.tsx';
import { FieldCount } from '../glass/FieldCount.tsx';
import { FormFoot } from '../glass/FormFoot.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { usePendingFrom, useNavigate } from '../router.tsx';
import { ClassCards } from './ClassCards.tsx';
import { PronounPicker, pronounsHold } from './PronounPicker.tsx';
import { words, type PronounSet } from '../../rules/pronouns.ts';
import { newCharacterFooter } from './footers.ts';
import './characters.css';
import { CalmRegion } from '../glass/Calm.tsx';

/** The most characters of a name, as the server holds it. */
const NAME_MAX = 40;

export function NewCharacter() {
  const { api, settings } = useKayfa();
  const { characters, loaded, refresh } = usePlayer();
  const navigate = useNavigate();
  const signedIn = useSignedIn(api);
  const [name, setName] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  /* The instance's default (`Settings.pronouns`), which the screen settings carry. */
  const [pronouns, setPronouns] = useState<PronounSet>(settings.pronouns);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /* The create's move names this button as its source: the button stays busy through the move, and the menu bar draws no second wait. */
  const source = useId();
  useClaim(source);
  const pendingFromMe = usePendingFrom(source);

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

  const submit = async () => {
    if (!cls || name.trim() === '' || [...name].length > NAME_MAX || !pronounsHold(pronouns) || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.createCharacter(name, cls, pronouns);
      if (!answer.ok) { setRefusal(answer.error); return; }
      await refresh();
      /* My characters opens on the new one, carried in history.state, never in the address. Its roster is read afresh: one read ahead
         (a rest on Cancel, which links there) was read before the character was made and would show the roster without it. */
      navigate('/characters', { state: { character: answer.value.id }, source, fresh: true });
    } catch {
      setRefusal('The character could not be made. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kb-new-character">
      <PageHead size="roster" title="New character" lead="This page is out of character, and no other player can see it. No other player can tell who plays a character." leadUnder />
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
          <p className="kb-roster-line">No other player will know {words(pronouns).their} class, unless you choose to reveal it.</p>
        </div>
        <PronounPicker name={name} value={pronouns} onChange={setPronouns} />
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        {/* In a calm, since "Make the character" waits drawn as text on a dashed edge until a name and a class are chosen. */}
        <FormFoot line={newCharacterFooter({ name, pronouns })}>
          <GlassButton to="/characters">Cancel</GlassButton>
          <GlassButton type="submit" kind="primary" busy={busy || pendingFromMe} disabled={!cls || name.trim() === '' || [...name].length > NAME_MAX || !pronounsHold(pronouns)}>Make the character</GlassButton>
        </FormFoot>
      </CalmRegion>
    </div>
  );
}
