/**
 * Profile edit, for the player's own characters only: title (up to 40 characters), signature
 * (BBCode, up to 500, with a preview drawn by the board's own renderer), pip style (the instance's
 * styles; the default alone in the slice) and the avatar. Another player's character, or an id
 * that is nobody's, says plainly that it is not one of yours; a character still waiting to debut
 * has no profile to edit until it has.
 */
import { useEffect, useState } from 'react';
import { BbCode } from '../bbcode/render.tsx';
import { useKayfa } from '../context.tsx';
import type { Character, Id } from '../data/api.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { AvatarEditor } from './Cropper.tsx';
import type { PictureIo } from './crops.ts';
import './profile-edit.css';

const TITLE_MAX = 40;
const SIGNATURE_MAX = 500;

export function ProfileEdit({ id, io }: { readonly id: Id; readonly io?: PictureIo }) {
  const { api, instance } = useKayfa();
  const { characters, loaded } = usePlayer();
  const signedIn = useSignedIn(api);
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
    if (!live) return;
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

  const back = <p><Link to="/characters">Back to your characters</Link></p>;
  if (!mine) {
    return (
      <div className="kb-profile-edit">
        <h1 className="kb-heading">Edit profile</h1>
        <p className="kb-notice">That is not one of your characters, so there is no profile here for you to edit.</p>
        {back}
      </div>
    );
  }
  if (mine.retiredAt !== null) {
    return (
      <div className="kb-profile-edit">
        <h1 className="kb-heading">{mine.name}</h1>
        <p className="kb-notice">{mine.name} is retired. An admin can restore it; until then its profile cannot be edited.</p>
        {back}
      </div>
    );
  }
  if (mine.debutedAt === null) {
    return (
      <div className="kb-profile-edit">
        <h1 className="kb-heading">{mine.name}</h1>
        <p className="kb-notice">{mine.name} is waiting to debut at the next settlement. It has no profile to edit until it has debuted.</p>
        {back}
      </div>
    );
  }
  if (profile === 'failed') return <div className="kb-profile-edit"><p className="kb-notice" data-kb-tone="refusal">The profile could not be loaded. Reload the page to try again.</p></div>;
  if (profile === null) return <div className="kb-profile-edit" aria-busy="true" />;

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

  return (
    <div className="kb-profile-edit">
      <p className="kb-crumb"><Link to="/">Index</Link> › <Link to="/characters">Your characters</Link> › {mine.name}</p>
      <h1 className="kb-heading">Edit {mine.name}</h1>
      <p className="kb-muted kb-small">What you set here is public: it shows beside {mine.name}&apos;s posts.</p>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="kb-field">
          <span>Title</span>
          <input className="kb-input kb-wide" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} aria-describedby="pe-title-count" />
        </label>
        <p id="pe-title-count" className="kb-small kb-muted">{[...title].length} of {TITLE_MAX}</p>
        <label className="kb-field">
          <span>Signature</span>
          <textarea className="kb-textarea" rows={4} value={signature} maxLength={SIGNATURE_MAX} onChange={(e) => setSignature(e.target.value)} aria-describedby="pe-signature-count" />
        </label>
        <p id="pe-signature-count" className="kb-small kb-muted">{[...signature].length} of {SIGNATURE_MAX}. BBCode, as in a post.</p>
        {signature.trim() && (
          <div className="kb-signature-preview" role="group" aria-label="Signature preview">
            <BbCode text={signature} />
          </div>
        )}
        <label className="kb-field">
          <span>Pip style</span>
          <select className="kb-select" value={pip} onChange={(e) => setPip(e.target.value)}>
            {instance.pipStyles.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </label>
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <p><button type="submit" className="kb-button" data-kb-primary="" disabled={busy}>Save the profile</button></p>
        <div role="status">{saved && <p className="kb-notice">{saved}</p>}</div>
      </form>
      <AvatarEditor character={profile} onSaved={setProfile} io={io} />
    </div>
  );
}
