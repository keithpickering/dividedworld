/**
 * Profile edit, for the player's own characters only: title (up to 40 characters), signature
 * (BBCode, up to 500, with a preview drawn by the board's own renderer), pip style (the instance's
 * styles; the default alone in the slice) and the avatar. The page has one address; the character
 * is chosen in the page, from a select of the player's own, opening on the one the My characters link
 * carried in history.state, else on the HUD's. No address names a character the player plays. A
 * character still waiting to debut has no profile to edit until it has.
 *
 * The page is two columns at a wide window (the Edit profile board): the fields and the avatar on
 * the left, and on the right "What everyone will see", the postbit as the board draws it (ProfilePreview.tsx),
 * given the form's own values and following what is typed, never saved or sent. One column below that.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Character, Id } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { FieldCount } from '../glass/FieldCount.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Link, useLocation } from '../router.tsx';
import { AvatarEditor } from './Cropper.tsx';
import { ProfilePreview } from './ProfilePreview.tsx';
import type { PictureIo } from './crops.ts';
import '../characters/characters.css';
import './profile-edit.css';
import { CalmRegion } from '../glass/Calm.tsx';

const TITLE_MAX = 40;
const SIGNATURE_MAX = 500;

/** The character a navigation carried in history.state, if it is a string; whether it is the player's own is checked by the page. */
const carriedBy = (state: unknown): unknown => (typeof state === 'object' && state !== null ? (state as { character?: unknown }).character : undefined);

export function ProfileEdit({ io }: { readonly io?: PictureIo }) {
  const { api, instance } = useKayfa();
  const { characters, loaded, hudCharacter } = usePlayer();
  const location = useLocation();
  const signedIn = useSignedIn(api);
  const [picked, setPicked] = useState<Id | null>(null);
  useEffect(() => { setPicked(null); }, [location]);
  const own = (x: unknown): x is Id => typeof x === 'string' && characters.some((c) => c.id === x);
  const id: Id | null = [picked, carriedBy(location.state), hudCharacter?.id].find(own)
    ?? characters.find((c) => c.debutedAt !== null && c.retiredAt === null)?.id ?? characters[0]?.id ?? null;
  const mine = characters.find((c) => c.id === id) ?? null;
  const [profile, setProfile] = useState<Character | null | 'failed'>(null);
  const [title, setTitle] = useState('');
  const [signature, setSignature] = useState('');
  const [pip, setPip] = useState('default');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState('');

  const live = mine !== null && mine.debutedAt !== null && mine.retiredAt === null;
  useEffect(() => {
    setProfile(null);
    setSaved('');
    setRefusal(null);
    if (!live || id === null) return;
    let current = true;
    void api.characters([id]).then((found) => {
      if (!current) return;
      const c = found[0] ?? null;
      setProfile(c);
      if (c) { setTitle(c.title); setSignature(c.signature); setPip(c.pipStyle); }
    }, () => { if (current) setProfile('failed'); });
    return () => { current = false; };
  }, [api, id, live]);

  if (signedIn === null || (signedIn && !loaded)) return <div className="kb-profile-edit" aria-busy="true" />;
  if (!signedIn) return <div className="kb-profile-edit"><SignInPrompt /></div>;

  const back = <CalmRegion><ButtonRow><GlassButton to="/characters" state={id === null ? undefined : { character: id }}>Back to your characters</GlassButton></ButtonRow></CalmRegion>;
  if (!mine || id === null) {
    return (
      <div className="kb-profile-edit">
        <PageHead size="roster" title="Edit profile" />
        <CalmRegion as="p" className="kb-notice">You have no characters yet, so there is no profile here for you to edit. <Link to="/characters/new">Make a character</Link> first.</CalmRegion>
        {back}
      </div>
    );
  }
  /*
   * The same frame in every state, so the select keeps its place in the tree (and its open list) while a profile loads, and a screen reader
   * that is on it is not moved: a state changes what stands under the select, never the select's own place. The preview, in the full
   * form's state alone, stands beside the fields as a second column.
   */
  const shell = (content: ReactNode, o: { readonly lead?: boolean; readonly preview?: ReactNode } = {}) => (
    <div className="kb-profile-edit">
      <PageHead size="roster" title={`Edit ${mine.name}`} lead={o.lead ? `What you set here is public: it shows beside ${mine.name}'s posts.` : undefined} leadUnder />
      <div className="kb-profile-columns">
        <div className="kb-profile-fields">
          <CalmRegion>
            <label className="kb-glass-field">
              <span>Character</span>
              <select className="kb-glass-select" value={id} onChange={(e) => setPicked(e.target.value)}>
                {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </CalmRegion>
          {content}
        </div>
        {o.preview}
      </div>
    </div>
  );
  if (mine.retiredAt !== null) {
    return shell(<><CalmRegion as="p" className="kb-notice">{mine.name} is retired. An admin can restore it; until then its profile cannot be edited.</CalmRegion>{back}</>);
  }
  if (mine.debutedAt === null) {
    return shell(<><CalmRegion as="p" className="kb-notice">{mine.name} is waiting to debut at the next settlement. It has no profile to edit until it has debuted.</CalmRegion>{back}</>);
  }
  if (profile === 'failed') return shell(<CalmRegion as="p" className="kb-notice" data-kb-tone="refusal">The profile could not be loaded. Reload the page to try again.</CalmRegion>);
  if (profile === null) return shell(<div aria-busy="true" />);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setSaved('');
    try {
      const answer = await api.setProfile(id, title, signature, pip);
      if (!answer.ok) { setRefusal(answer.error); return; }
      setProfile(answer.value);
      setSaved('Profile saved.');
    } catch {
      setRefusal('The profile could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return shell(
    <>
      <CalmRegion as="form" aria-label="Profile" className="kb-profile-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="kb-profile-field">
          <label className="kb-glass-field">
            <span>Title</span>
            <input className="kb-glass-input" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} aria-describedby="pe-title-count" />
          </label>
          <FieldCount id="pe-title-count" hint="Under the name on every post." text={title} max={TITLE_MAX} />
        </div>
        <div className="kb-profile-field">
          <label className="kb-glass-field">
            <span>Signature</span>
            <textarea className="kb-glass-input kb-glass-textarea" rows={4} value={signature} maxLength={SIGNATURE_MAX} onChange={(e) => setSignature(e.target.value)} aria-describedby="pe-signature-count" />
          </label>
          <FieldCount id="pe-signature-count" hint="BBCode, as in a post." text={signature} max={SIGNATURE_MAX} />
        </div>
        <label className="kb-glass-field">
          <span>Pip style</span>
          <select className="kb-glass-select" value={pip} onChange={(e) => setPip(e.target.value)}>
            {instance.pipStyles.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <ButtonRow><GlassButton type="submit" kind="primary" disabled={busy}>Save the profile</GlassButton></ButtonRow>
        <div role="status">{saved && <p className="kb-notice">{saved}</p>}</div>
      </CalmRegion>
      <CalmRegion><AvatarEditor character={profile} onSaved={setProfile} io={io} /></CalmRegion>
    </>,
    { lead: true, preview: <ProfilePreview character={profile} title={title} signature={signature} pipStyle={pip} /> },
  );
}
